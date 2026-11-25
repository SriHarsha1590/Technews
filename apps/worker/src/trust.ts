// Decides whether a link may be shown behind "Try it". These rules are the safety boundary:
// the AI only suggests which links fit; code decides which links are allowed.
import { getDomain } from 'tldts';
import type { Source, TrustTier, TryLinkType } from '@technews/shared';
import { SOURCES } from './sources';

/** Registrable domain ("site"): docs.github.com -> github.com, blog.google -> blog.google, bbc.co.uk -> bbc.co.uk. */
export function siteOf(hostOrUrl: string): string | null {
  return getDomain(hostOrUrl);
}

// Code and package hosts. Anyone can publish here, so we only accept them for repos and playgrounds
// (e.g. a Hugging Face Space), never for downloads.
const CODE_HOSTS = new Set(['github.com', 'gitlab.com', 'huggingface.co', 'npmjs.com', 'pypi.org']);

// These services host content uploaded by anyone. Only known vendor namespaces
// can be verified from a URL alone; unknown namespaces need manual review.
const VENDOR_NAMESPACES: Record<string, string[]> = {
  'openai.com': ['openai'],
  'chatgpt.com': ['openai'],
  'github.blog': ['github'],
  'github.com': ['github'],
  'huggingface.co': ['huggingface'],
  'google.com': ['google'],
  'microsoft.com': ['microsoft'],
  'kubernetes.io': ['kubernetes'],
  'docker.com': ['docker'],
  'mozilla.org': ['mozilla'],
};

function trustedHostedPath(url: URL, allowedSites: Iterable<string>): boolean {
  const site = siteOf(url.hostname);
  if (!site || !CODE_HOSTS.has(site)) return true;
  const host = url.hostname.toLowerCase();
  // Only explicit documentation subdomains are vendor-controlled. Other
  // subdomains can expose user namespaces (for example, gist.github.com).
  if (host !== site && host !== `www.${site}` && host !== 'gist.github.com') {
    return host === `docs.${site}`;
  }
  const parts = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (site === 'huggingface.co' && parts[0] === 'spaces') parts.shift();
  const namespaces = new Set([...allowedSites].flatMap((s) => VENDOR_NAMESPACES[s] ?? []));
  return !!parts[0] && namespaces.has(parts[0]);
}

export interface PageContext {
  tier: TrustTier; // trust tier of the source page the link was found on
  ownSites: string[]; // sites owned by that page's company (official pages only)
}

/** Every site owned by any of our official sources: the only vendor sites trusted from press pages. */
export function knownVendorSites(sources: Source[] = SOURCES): Set<string> {
  return new Set(sources.flatMap((s) => (s.trustTier === 'official' ? s.ownDomains ?? [] : [])));
}

/** Works out who owns the page a link was found on. */
export function pageContext(pageUrl: string, tier: TrustTier, sources: Source[] = SOURCES): PageContext {
  const site = siteOf(pageUrl);
  if (tier !== 'official' || !site) return { tier, ownSites: [] };
  const owner = sources.find((s) => s.trustTier === 'official' && s.ownDomains?.includes(site));
  return { tier, ownSites: owner?.ownDomains ?? [site] };
}

/**
 * The rules:
 * 1. https only.
 * 2. Found on an official page: allowed if it stays on that company's own sites.
 *    Code hosts are allowed for repo/playground/docs, but not downloads.
 * 3. Found on a press or community page: allowed only to a known vendor's own site or a code host,
 *    and never as a download.
 */
export function isTrustedLink(url: URL, type: TryLinkType, page: PageContext, vendors: Set<string> = knownVendorSites()): boolean {
  if (url.protocol !== 'https:') return false;
  const site = siteOf(url.hostname);
  if (!site) return false;

  const isCodeHost = CODE_HOSTS.has(site);
  const allowedSites = page.tier === 'official' ? page.ownSites : vendors;
  if (isCodeHost && !trustedHostedPath(url, allowedSites)) return false;
  if (page.tier === 'official') {
    if (page.ownSites.includes(site)) return true;
    return isCodeHost && type !== 'download';
  }
  if (type === 'download') return false;
  return vendors.has(site) || isCodeHost;
}
