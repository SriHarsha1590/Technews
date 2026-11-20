import { log } from '@temporalio/activity';
import webpush from 'web-push';
import type { PushSubscriptionDoc, Story, UserDoc } from '@technews/shared';
import { stories, database } from '../db';
import { config } from '../config';
import { buildDigestMessage, isDue } from '../digest';

const STORIES_PER_DIGEST = 3;

export interface DigestRunSummary {
  due: number;
  sent: number;
  nothingNew: number;
  noDevice: number;
  removedSubscriptions: number;
}

/** Sends today's digest to every reader whose chosen hour has come, on every device they turned notifications on. */
export async function sendDigests(): Promise<DigestRunSummary> {
  const summary: DigestRunSummary = { due: 0, sent: 0, nothingNew: 0, noDevice: 0, removedSubscriptions: 0 };
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    log.warn('VAPID keys are not set: skipping digests (see docs/05-accounts.md)');
    return summary;
  }
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);

  const db = await database();
  const users = db.collection<UserDoc>('users');
  const pushes = db.collection<PushSubscriptionDoc>('push_subscriptions');
  const storyCol = await stories();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3_600_000);

  for (const user of await users.find({ 'digest.enabled': true }).toArray()) {
    const { due, today } = isDue(user.digest, user.lastDigestOn, now);
    if (!due) continue;
    summary.due++;
    const markDone = () => users.updateOne({ _id: user._id }, { $set: { lastDigestOn: today } });

    const devices = await pushes.find({ userId: user._id }).toArray();
    if (!devices.length) {
      summary.noDevice++;
      await markDone();
      continue;
    }

    const filter = user.stack.length ? { publishedAt: { $gte: since }, tags: { $in: user.stack } } : { publishedAt: { $gte: since } };
    const top = await storyCol
      .find(filter)
      .sort({ score: -1 })
      .limit(STORIES_PER_DIGEST)
      .project<Pick<Story, 'title' | 'tags'>>({ title: 1, tags: 1 })
      .toArray();
    if (!top.length) {
      summary.nothingNew++; // no empty notifications
      await markDone();
      continue;
    }

    const payload = JSON.stringify(buildDigestMessage(top, user.stack));
    for (const d of devices) {
      try {
        await webpush.sendNotification({ endpoint: d.endpoint, keys: d.keys }, payload, { TTL: 6 * 3600 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await pushes.deleteOne({ _id: d._id }); // browser unsubscribed or was reset
          summary.removedSubscriptions++;
        } else {
          log.warn('push failed', { user: user._id, status, message: (err as Error).message });
        }
      }
    }
    await markDone();
    summary.sent++;
  }
  return summary;
}
