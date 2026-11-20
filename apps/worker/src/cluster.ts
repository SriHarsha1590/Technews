// Groups headlines about the same event. Word-overlap is cheap and good enough to start;
// shortcut: switch to embeddings when we see "same story, different wording" misses.

const STOPWORDS = new Set(
  'a an and are as at be by for from has have how in into is it its new of on or that the this to was what when why will with you your now just about after over'.split(' '),
);

export function titleTokens(title: string): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9.+#\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/** Two headlines are the same story if they share at least 3 meaningful words and half their words overall. */
export function sameStory(a: string, b: string): boolean {
  const ta = titleTokens(a);
  const tb = new Set(titleTokens(b));
  const shared = ta.filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return shared >= 3 && union > 0 && shared / union >= 0.5;
}

/** Greedy grouping: each item joins the first group whose first headline matches. */
export function groupByTitle<T extends { title: string }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const home = groups.find((g) => sameStory(g[0].title, item.title));
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups;
}
