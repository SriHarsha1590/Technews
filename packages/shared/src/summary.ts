import { z } from 'zod';
import { CATEGORIES } from './types';

export const SUMMARY_MIN_WORDS = 80;
export const SUMMARY_MAX_WORDS = 150;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Shape we ask the AI for. Refinements enforce rules the AI is only "asked" to follow. */
export const StorySummary = z.object({
  index: z.number().int().min(0),
  title: z.string().min(10).max(120),
  summary: z.string().refine(
    (s) => {
      const n = wordCount(s);
      return n >= SUMMARY_MIN_WORDS && n <= SUMMARY_MAX_WORDS;
    },
    { message: `summary must be ${SUMMARY_MIN_WORDS}-${SUMMARY_MAX_WORDS} words` },
  ),
  tags: z.array(z.string().min(1).max(40)).min(1).max(5),
  category: z.enum(CATEGORIES),
});
export type StorySummary = z.infer<typeof StorySummary>;

/** Item the AI returns when the text is too thin to summarize honestly. */
export const InsufficientItem = z.object({
  index: z.number().int().min(0),
  insufficient: z.literal(true),
});

/** Loose schema sent to Gemini as the response format. Strict checks happen per item afterwards. */
export const SummaryResponseItem = z.object({
  index: z.number().int(),
  insufficient: z.boolean().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.enum(CATEGORIES).optional(),
});
export const SummaryResponse = z.array(SummaryResponseItem);
