import { log } from '@temporalio/activity';
import { extractImage, type Story } from '@technews/shared';
import { safeFetchHtml } from '@technews/shared/safe-fetch';
import { stories } from '../db';
import { USER_AGENT } from '../config';

const LOOKBACK_HOURS = 72;

/**
 * Stories whose feeds had no picture: use the article page's own og:image for the card.
 * ids: only these stories (each pipeline batch, right after it is saved). Without ids, catches up on recent ones.
 * Each page is read once: imageCheckedAt is set whether or not an image was found.
 */
export async function findStoryImages(limit: number, ids?: string[]): Promise<number> {
  const col = await stories();
  const list = await col
    .find({
      imageUrl: null, // matches null and missing
      imageCheckedAt: { $exists: false },
      publishedAt: { $gte: new Date(Date.now() - LOOKBACK_HOURS * 3_600_000) },
      ...(ids ? { _id: { $in: ids } } : {}),
    })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .project<Pick<Story, '_id' | 'primaryUrl'>>({ _id: 1, primaryUrl: 1 })
    .toArray();

  // In parallel: one slow site doesn't hold up the rest.
  const found = await Promise.all(
    list.map(async (s) => {
      const html = await safeFetchHtml(s.primaryUrl, { userAgent: USER_AGENT });
      const imageUrl = html ? extractImage(html, s.primaryUrl) : null;
      await col.updateOne({ _id: s._id }, { $set: { imageUrl, imageCheckedAt: new Date() } });
      return imageUrl ? 1 : 0;
    }),
  );
  const withImage = found.reduce<number>((n, x) => n + x, 0);
  if (list.length) log.info('story images', { checked: list.length, found: withImage });
  return withImage;
}
