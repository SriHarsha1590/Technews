// The API's only link to the AI provider (Gemini's free tier). Mirrors the worker's llm.ts and shares its
// daily budget in Redis, so Watch, Try it and Ask can never push the day's calls past LLM_DAILY_CAP.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { RedisClientType } from 'redis';

export interface Ai {
  /** Asks for JSON matching `schema` (loosely); callers validate strictly afterwards. */
  json(prompt: string, schema: z.ZodType): Promise<unknown>;
}

/** No key, daily cap reached, or the provider is busy: the reader sees "try again later", never a stack trace. */
export class AiUnavailable extends Error {}

interface Options {
  apiKey: string;
  model: string;
  dailyCap: number;
  redis: Pick<RedisClientType, 'incr' | 'expire'>;
}

export function geminiAi({ apiKey, model, dailyCap, redis }: Options): Ai {
  let client: GoogleGenAI | undefined;

  async function takeDailyBudget() {
    const key = `llm:calls:${new Date().toISOString().slice(0, 10)}`; // same key as the worker
    let used: number;
    try {
      used = await redis.incr(key);
      if (used === 1) await redis.expire(key, 2 * 24 * 3600);
    } catch {
      return; // Redis down: Gemini's own free-tier limits still apply
    }
    if (used > dailyCap) throw new AiUnavailable('The daily AI limit has been reached. Try again tomorrow.');
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
        console.warn('ai call failed', (err as Error).message);
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
