// Shapes we ask the AI for on demand (Watch, Try it steps, Ask). As with summaries, the rules are
// enforced here in code; the prompt only asks for them.
import { z } from 'zod';
import { wordCount } from './summary';

/** At a calm narration pace (~2.4 words a second) this is roughly 30 to 60 seconds. */
export const EXPLAINER_MIN_WORDS = 70;
export const EXPLAINER_MAX_WORDS = 145;
export const WORDS_PER_SECOND = 2.4;

const URL_LIKE = /\bhttps?:\/\/|\bwww\.\S/i;

export const ExplainerScene = z.object({
  caption: z.string().trim().min(3).max(70), // big on-screen text
  narration: z.string().trim().min(10).max(320), // spoken aloud
});
export type ExplainerScene = z.infer<typeof ExplainerScene>;

export const ExplainerScript = z.object({
  scenes: z
    .array(ExplainerScene)
    .min(3)
    .max(6)
    .refine(
      (scenes) => {
        const n = wordCount(scenes.map((s) => s.narration).join(' '));
        return n >= EXPLAINER_MIN_WORDS && n <= EXPLAINER_MAX_WORDS;
      },
      { message: `narration must be ${EXPLAINER_MIN_WORDS}-${EXPLAINER_MAX_WORDS} words in total` },
    ),
});
export type ExplainerScript = z.infer<typeof ExplainerScript>;

/** Steps never carry addresses: the only links shown are verified ones and the story's own sources. */
export const TryGuideScript = z.object({
  steps: z
    .array(z.string().trim().min(8).max(240).refine((s) => !URL_LIKE.test(s), { message: 'steps must not contain URLs' }))
    .max(5),
});
export type TryGuideScript = z.infer<typeof TryGuideScript>;

export const AskAnswer = z.object({
  answer: z.string().trim().min(1).max(2500),
  storyNumbers: z.array(z.number().int().min(0)).max(10), // which cards the answer came from
});
export type AskAnswer = z.infer<typeof AskAnswer>;
