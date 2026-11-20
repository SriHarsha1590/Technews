import { createHash } from 'node:crypto';

const TRACKING = /^(utm_|fbclid$|gclid$|ref$|ref_src$|mc_)/;

/** Same story with different tracking params, www or #fragment maps to one URL. */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING.test(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function articleId(raw: string): string {
  return createHash('sha256').update(canonicalUrl(raw)).digest('hex').slice(0, 24);
}
