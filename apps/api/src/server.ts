import { MongoClient } from 'mongodb';
import { createClient } from 'redis';
import { safeFetchHtml } from '@technews/shared/safe-fetch';
import { createApp } from './app';
import { ensureContentRetentionIndexes, ensureStoryTextIndex, mongoAssistStore, mongoStoryStore, redisFeedStore } from './stores';
import { ensureUserIndexes, mongoUserStore } from './users';
import { firebaseVerifier } from './auth';
import { geminiAi } from './ai';
import { temporalRefresher } from './refresh';
import { config, USER_AGENT } from './config';

/** HTML of one of our stories' source pages, or '' if it can't be read. Never called with reader-supplied URLs. */
async function fetchHtml(url: string): Promise<string> {
  return safeFetchHtml(url, { timeoutMs: 10_000, userAgent: USER_AGENT });
}

async function main() {
  const mongo = new MongoClient(config.mongoUrl);
  await mongo.connect();
  await ensureUserIndexes(mongo, config.mongoDb);
  await ensureContentRetentionIndexes(mongo, config.mongoDb);
  await ensureStoryTextIndex(mongo, config.mongoDb).catch((err) => console.warn('could not create the story search index', err.message));

  const redis = createClient({ url: config.redisUrl });
  redis.on('error', (err) => console.warn('redis error (feed will fall back to MongoDB)', err.message));
  await redis.connect().catch((err) => console.warn('redis not reachable at startup', err.message));

  if (!config.geminiApiKey) console.warn('GEMINI_API_KEY is not set: Watch, Try it steps and Ask will be unavailable');
  const ai = geminiAi({ apiKey: config.geminiApiKey, model: config.geminiModel, dailyCap: config.publicLlmDailyCap, redis });

  if (!config.firebaseProjectId) console.warn('FIREBASE_PROJECT_ID is empty: sign-in features are off (see docs/05-accounts.md)');
  if (!config.vapidPublicKey) console.warn('VAPID_PUBLIC_KEY is empty: notifications are off (see docs/05-accounts.md)');

  const app = createApp({
    feeds: redisFeedStore(redis),
    stories: mongoStoryStore(mongo, config.mongoDb),
    users: mongoUserStore(mongo, config.mongoDb),
    verify: firebaseVerifier(config.firebaseProjectId),
    assist: { store: mongoAssistStore(mongo, config.mongoDb), ai, fetchHtml },
    refresher: temporalRefresher(),
    webOrigins: config.webOrigins,
    vapidPublicKey: config.vapidPublicKey,
    aiRequestsPerMinute: config.aiRequestsPerMinute,
    requestsPerMinute: config.requestsPerMinute,
    userRequestsPerMinute: config.userRequestsPerMinute,
    trustProxy: config.trustProxy,
    refreshAdminUids: config.refreshAdminUids,
    sharedCounter: async (key) => {
      const k = `rl:${key}:${Math.floor(Date.now() / 60_000)}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 120);
      return n;
    },
  });
  const server = app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}/api/v1`));

  const shutdown = () => {
    server.close(async () => {
      await mongo.close();
      if (redis.isOpen) await redis.quit();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
