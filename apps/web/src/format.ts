import type { TrustTier } from '@technews/shared';

/** Compact relative time for card headers: "just now", "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Plain-language name for each trust tier, as shown to readers. */
export const TRUST_LABEL: Record<TrustTier, string> = {
  official: 'Official source',
  press: 'News outlet',
  community: 'Community',
};

export const CATEGORY_LABEL = {
  all: 'All',
  ai: 'AI',
  tools: 'Tools',
  dev: 'Dev',
  cloud: 'Cloud',
  security: 'Security',
  research: 'Research',
  general: 'General',
} as const;

export function coverageText(count: number): string {
  return count > 1 ? `Covered by ${count} sources` : 'Covered by 1 source';
}
