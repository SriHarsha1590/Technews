// Ask's suggestion buttons, built from the news actually loaded, so they change as the news does.
import type { StoryCard } from '@technews/shared';

// Short tags like "llm", "gpu" or "api" are usually jargon worth explaining; longer ones are mostly names.
const isAcronym = (tag: string) => /^[a-z0-9]{2,4}$/.test(tag);

/** Tags are lowercase: "llm" -> "LLM", "github copilot" -> "Github Copilot". */
function termName(tag: string): string {
  if (isAcronym(tag)) return tag.toUpperCase();
  return tag.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The most common topics across the loaded stories, most frequent first. */
function topTags(stories: StoryCard[], count: number): string[] {
  const freq = new Map<string, number>();
  for (const s of stories) for (const t of s.tags) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(([t]) => t);
}

/** Three questions for the Ask panel: about the focused card, or about the most common topics in the feed. */
export function suggestions(stories: StoryCard[], focus: StoryCard | null): string[] {
  if (focus) {
    const term = focus.tags.find(isAcronym);
    return ['Explain this simply', term ? `What does ${termName(term)} mean?` : 'Explain the tech words in this', 'Who should care about this?'];
  }
  const tags = topTags(stories, 10);
  const out = ["What are today's biggest stories?"];
  if (tags[0]) out.push(`What's the latest on ${termName(tags[0])}?`);
  const term = tags.find((t) => t !== tags[0] && isAcronym(t));
  if (term) out.push(`What does ${termName(term)} mean?`);
  else if (tags[1]) out.push(`What's the latest on ${termName(tags[1])}?`);
  return out;
}
