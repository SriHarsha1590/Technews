// The only file that knows which AI provider we use. Switching providers = rewriting this file.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { config } from './config';
import { getRedis } from './db';

let client: GoogleGenAI | undefined;

export class DailyCapReached extends Error {}

/** Counts every AI call per UTC day in Redis and refuses once LLM_DAILY_CAP is hit. */
async function takeDailyBudget(): Promise<void> {
  const redis = await getRedis();
  const key = `llm:worker:calls:${new Date().toISOString().slice(0, 10)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * 24 * 3600);
  if (used > config.llmDailyCap) throw new DailyCapReached(`LLM daily cap of ${config.llmDailyCap} reached`);
}

/** Asks the model for JSON matching `schema` (loosely); callers validate strictly afterwards. */
export async function generateJson(prompt: string, schema: z.ZodType): Promise<unknown> {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set (see .env.example)');
  await takeDailyBudget();
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });

  const res = await client.models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(schema),
      temperature: 0.3,
    },
  });
  if (!res.text) throw new Error('empty response from model');
  return JSON.parse(res.text);
}
