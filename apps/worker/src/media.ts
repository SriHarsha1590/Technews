// Image and byline of one feed item. Feeds put these in many different places, so we try them in order.

/** The parts of an rss-parser item we read. media:* fields come from the parser's customFields. */
export interface FeedItemMedia {
  enclosure?: { url?: string; type?: string };
  mediaContent?: { $?: { url?: string; medium?: string; type?: string } }[];
  mediaThumbnail?: { $?: { url?: string } }[];
  content?: string;
  'content:encoded'?: string;
  creator?: string;
  author?: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

/** https only: the web app is served over https, and a broken image is worse than none. */
function httpsUrl(raw: string | undefined, base?: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim().replace(/&amp;/g, '&'), base);
    if (url.protocol !== 'https:') return null;
    // BBC feeds link 240px thumbnails; the same path serves any width, and a card needs a bigger one.
    if (url.hostname === 'ichef.bbci.co.uk') url.pathname = url.pathname.replace(/\/standard\/\d+\//, '/standard/800/');
    return url.toString();
  } catch {
    return null;
  }
}

const isImage = (url?: string, type?: string, medium?: string) =>
  medium === 'image' || (type ?? '').startsWith('image/') || (!type && !medium && IMAGE_EXT.test(url ?? ''));

export function imageOf(item: FeedItemMedia, pageUrl?: string): string | null {
  for (const m of item.mediaContent ?? []) {
    const { url, type, medium } = m.$ ?? {};
    if (isImage(url, type, medium)) {
      const found = httpsUrl(url, pageUrl);
      if (found) return found;
    }
  }
  for (const t of item.mediaThumbnail ?? []) {
    const found = httpsUrl(t.$?.url, pageUrl);
    if (found) return found;
  }
  if (item.enclosure && isImage(item.enclosure.url, item.enclosure.type)) {
    const found = httpsUrl(item.enclosure.url, pageUrl);
    if (found) return found;
  }
  // Last resort: the first picture in the item's HTML, skipping tracking pixels and emoji.
  for (const html of [item['content:encoded'], item.content]) {
    for (const tag of html?.match(/<img\b[^>]*>/gi) ?? []) {
      if (/\b(?:width|height)=["']?1["'\s>]/i.test(tag) || /emoji|feedburner|pixel/i.test(tag)) continue;
      const found = httpsUrl(tag.match(/\ssrc=["']([^"']+)["']/i)?.[1], pageUrl);
      if (found) return found;
    }
  }
  return null;
}

const MAX_AUTHOR_CHARS = 60;

/** "Jane Doe", from dc:creator or author. Emails are dropped; long author lists become "First Author et al.". */
export function authorOf(item: FeedItemMedia): string | null {
  for (const raw of [item.creator, item.author]) {
    if (typeof raw !== 'string') continue;
    let name = raw.replace(/\s+/g, ' ').trim();
    name = name.match(/^\S+@\S+\s+\((.+)\)$/)?.[1] ?? name; // RSS style: "noreply@blogger.com (Jane Doe)"
    name = name.replace(/^by\s+/i, '').replace(/\.?\s*(?:Photographs?|Illustrations?):.*$/i, ''); // Guardian adds photo credits
    if (!name || /^\S+@\S+$/.test(name) || /^unknown$/i.test(name)) continue;
    if (name.length > MAX_AUTHOR_CHARS || (/,|\band\b/.test(name) && name.length > 40)) {
      name = `${name.split(/,|\band\b/)[0].trim()} et al.`;
    }
    return name.slice(0, MAX_AUTHOR_CHARS);
  }
  return null;
}
