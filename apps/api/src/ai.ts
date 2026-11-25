// The API's only link to the AI provider (Gemini's free tier). Mirrors the worker's llm.ts and shares its
// separate daily budget in Redis, reserving the worker's allocation for ingestion.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { RedisClientType } from 'redis';

export interface Ai {
  /** Asks for JSON matching `schema` (loosely); callers validate strictly afterwards. */
  json(prompt: string, schema: z.ZodType): Promise<unknown>;
}

/** No key, daily cap reached, or the provider is busy: the reader sees "try again later", never a stack trace. */
export class AiUnavailable extends Error {
  constructor(message: string, readonly reason: 'cap' | 'budget_store' | 'provider' = 'provider') { super(message); }
}

interface Options {
  apiKey: string;
  model: string;
  dailyCap: number;
  redis: Pick<RedisClientType, 'incr' | 'expire'>;
}

export function geminiAi({ apiKey, model, dailyCap, redis }: Options): Ai {
  let client: GoogleGenAI | undefined;

  async function takeDailyBudget() {
    const key = `llm:public:calls:${new Date().toISOString().slice(0, 10)}`;
    let used: number;
    try {
      used = await redis.incr(key);
      if (used === 1) await redis.expire(key, 2 * 24 * 3600);
    } catch {
      throw new AiUnavailable('The AI quota service is unavailable. Try again later.', 'budget_store');
    }
    if (used > dailyCap) throw new AiUnavailable('The daily AI limit has been reached. Try again tomorrow.', 'cap');
  }

  return {
    async json(prompt, schema) {
      if (!apiKey) throw new AiUnavailable('AI features need GEMINI_API_KEY in .env (free at https://aistudio.google.com/apikey).');
      await takeDailyBudget();
      client ??= new GoogleGenAI({ apiKey });
      let text: string | undefined;
      try {
        const res = await client.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(schema), temperature: 0.4 },
        });
        text = res.text;
      } catch (err) {
        console.warn(JSON.stringify({ time: new Date().toISOString(), event: 'public_ai_provider_failed' }));
        throw new AiUnavailable('The AI service is busy right now. Try again in a minute.');
      }
      if (!text) throw new AiUnavailable('The AI service returned nothing. Try again.');
      try {
        return JSON.parse(text);
      } catch {
        return null; // caller's validation treats this as a bad answer
      }
    },
  };
}
