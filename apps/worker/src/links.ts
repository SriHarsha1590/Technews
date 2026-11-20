// Pulls candidate links out of a source page. Only these exact URLs can ever become try links,
// so the AI has no way to invent an address.

export interface PageLink {
  url: string;
  text: string;
}

const JUNK_PATH = /\/(privacy|terms|legal|cookies?|careers|jobs|about|contact|login|log-in|signin|sign-in|press|newsroom|subscribe|newsletter|author|tag|category)(\/|$)/i;
const JUNK_HOST = /(^|\.)(twitter\.com|x\.com|facebook\.com|linkedin\.com|reddit\.com|instagram\.com|youtube\.com|news\.ycombinator\.com|t\.co)$/i;

const clean = (s: string) =>
  s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export function extractLinks(html: string, pageUrl: string, max = 60): PageLink[] {
  const page = new URL(pageUrl);
  // Links in navigation and footers are site chrome, not part of the announcement.
  const body = html.replace(/<(script|style|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const seen = new Set<string>();
  const out: PageLink[] = [];

  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(m[1].trim(), page);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    url.hash = '';
    const key = url.toString();
    if (key === page.toString() || seen.has(key)) continue;
    if (JUNK_HOST.test(url.hostname) || JUNK_PATH.test(url.pathname)) continue;

    const text = clean(m[2]).slice(0, 80);
    if (!text) continue; // icon-only links say nothing about where they go
    seen.add(key);
    out.push({ url: key, text });
    if (out.length >= max) break;
  }
  return out;
}
