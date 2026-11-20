import { MongoClient, type Collection, type Db } from 'mongodb';
import { createClient } from 'redis';
import type { Article, Story } from '@technews/shared';
import { config } from './config';

let mongo: MongoClient | undefined;
let redis: ReturnType<typeof createClient> | undefined;

export async function database(): Promise<Db> {
  if (!mongo) {
    mongo = new MongoClient(config.mongoUrl);
    await mongo.connect();
  }
  return mongo.db(config.mongoDb);
}

export const articles = async (): Promise<Collection<Article>> => (await database()).collection<Article>('articles');
export const stories = async (): Promise<Collection<Story>> => (await database()).collection<Story>('stories');

export async function getRedis() {
  if (!redis) {
    redis = createClient({ url: config.redisUrl });
    redis.on('error', (err) => console.error('redis error', err));
    await redis.connect();
  }
  return redis;
}

export async function ensureIndexes(): Promise<void> {
  await (await articles()).createIndexes([
    { key: { status: 1, fetchedAt: 1 } }, // summarizer picks up 'new' articles, oldest first
    { key: { storyId: 1 } },
  ]);
  await (await stories()).createIndexes([
    { key: { publishedAt: -1 } }, // feed rebuild + story matching window
    { key: { category: 1, score: -1 } }, // API fallback when Redis is empty
    { key: { tryCheckedAt: 1, publishedAt: -1 } }, // try-links workflow finds unsearched stories
    { key: { 'tryLinks.checkedAt': 1 } }, // weekly re-check
    { key: { imageCheckedAt: 1, publishedAt: -1 } }, // image search finds stories it hasn't looked at
  ]);
}

export async function closeConnections(): Promise<void> {
  await mongo?.close();
  if (redis?.isOpen) await redis.quit();
  mongo = undefined;
  redis = undefined;
}
