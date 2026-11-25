// Pulls readable text and preview images from bounded article HTML. The text is only sent to AI.
import { parse } from 'parse5';

const MAX_HTML_CHARS = 2_000_000;
const SKIP = new Set(['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'noscript', 'template']);

type HtmlNode = {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
};

function documentOf(html: string): HtmlNode {
  return parse(html.slice(0, MAX_HTML_CHARS)) as HtmlNode;
}

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function* elements(node: HtmlNode): Generator<HtmlNode> {
  if (node.tagName) yield node;
  if (SKIP.has(node.tagName ?? '')) return;
  for (const child of node.childNodes ?? []) yield* elements(child);
}

function textOf(node: HtmlNode): string {
  if (SKIP.has(node.tagName ?? '')) return '';
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textOf).join(' ');
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

export function extractText(html: string, maxChars = 1500): string {
  const doc = documentOf(html);
  let description = '';
  const paragraphs: string[] = [];
  for (const node of elements(doc)) {
    if (node.tagName === 'meta' && !description && ['og:description', 'description'].includes(attr(node, 'property') ?? attr(node, 'name') ?? '')) {
      description = clean(attr(node, 'content') ?? '');
    }
    if (node.tagName === 'p') {
      const paragraph = clean(textOf(node));
      if (paragraph.length > 40) paragraphs.push(paragraph);
    }
  }
  return [description, ...paragraphs].filter(Boolean).join('\n').slice(0, Math.max(0, maxChars));
}

/** The page's own preview image, as an absolute HTTPS URL, or null. */
export function extractImage(html: string, pageUrl: string): string | null {
  for (const node of elements(documentOf(html))) {
    if (node.tagName !== 'meta') continue;
    const name = attr(node, 'property') ?? attr(node, 'name');
    if (!name || !['og:image', 'og:image:secure_url', 'twitter:image'].includes(name.toLowerCase())) continue;
    const content = attr(node, 'content')?.trim();
    if (!content) continue;
    try {
      const url = new URL(content, pageUrl);
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch {
      // Malformed candidate: try the next metadata element.
    }
  }
  return null;
}
