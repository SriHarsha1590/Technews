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

// Identifiers are a stronger signal than word overlap: a version or model variant
// change is a different announcement even when the rest of the headline matches.
const PRODUCT_TOKENS = new Set(['gpt', 'gemini', 'claude', 'llama', 'node.js', 'kubernetes', 'iphone', 'ipad', 'macbook', 'pixel', 'galaxy', 'surface', 'ryzen', 'geforce', 'rtx', 'windows', 'android', 'ios']);
const MODEL_VARIANTS = new Set(['pro', 'air', 'plus', 'edge', 'studio', 'flash', 'ultra', 'lite', 'mini', 'max', 'astra', 'sonnet', 'opus', 'haiku', 'nano']);

function identityTokens(title: string): Set<string> {
  const lower = title.toLowerCase();
  const tokens = titleTokens(title);
  const identities = new Set(tokens.filter((token) => PRODUCT_TOKENS.has(token) || MODEL_VARIANTS.has(token)));
  for (const match of lower.matchAll(/\b(?:[a-z]+(?:\.[a-z]+)?[- ]?)?\d+(?:\.\d+)*(?:[-.][a-z0-9]+)?\b/g)) {
    identities.add(match[0].replace(/\s+/g, '-'));
  }
  return identities;
}

/** Two headlines are the same story if they share at least 3 meaningful words and half their words overall. */
export function sameStory(a: string, b: string): boolean {
  const ia = identityTokens(a);
  const ib = identityTokens(b);
  if (ia.size !== ib.size || [...ia].some((token) => !ib.has(token))) return false;
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
