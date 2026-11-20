// Pulls readable text and the preview image out of an article page. Used by the worker (thin feed items)
// and the API (Watch). The text is only passed to the AI, never stored.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function decode(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) || m : m));
}

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function extractText(html: string, maxChars = 1500): string {
  const meta =
    html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? '';
  const body = html.replace(/<(script|style|nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => clean(m[1]))
    .filter((p) => p.length > 40); // skip captions, bylines, cookie notes
  return [clean(meta), ...paragraphs].filter(Boolean).join('\n').slice(0, maxChars);
}

/** The page's own preview image (og:image or twitter:image), as an absolute https URL, or null. */
export function extractImage(html: string, pageUrl: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["']/i.test(tag)) continue;
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (!content) continue;
    try {
      const url = new URL(decode(content.trim()), pageUrl);
      if (url.protocol === 'https:') return url.toString();
    } catch {
      // malformed: try the next tag
    }
  }
  return null;
}
