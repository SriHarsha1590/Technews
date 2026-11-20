// A tiny router: the page is the URL path, so Saved, History and Profile can be bookmarked and shared.
// The server (Nginx, Vite) answers every path with index.html.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export type Page = 'feed' | 'saved' | 'history' | 'profile' | 'signin';

const PATHS: Record<string, Page> = { '/': 'feed', '/saved': 'saved', '/history': 'history', '/profile': 'profile', '/signin': 'signin' };

const CHANGE = 'technews:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}

const snapshot = () => location.pathname + location.search;

/** The current page and query, e.g. "/history?filter=watched". Re-renders on every navigation. */
export function useLocation(): { page: Page; params: URLSearchParams; href: string } {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, location.origin);
  return { page: PATHS[url.pathname.replace(/\/+$/, '') || '/'] ?? 'feed', params: url.searchParams, href };
}

export function navigate(to: string, { replace = false } = {}) {
  if (to === snapshot()) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.dispatchEvent(new Event(CHANGE));
}

/** Where the sign-in page sends the reader afterwards. Only paths on this site, never another domain. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/signin') ? next : '/';
}

export const signInHref = (next = snapshot()) => `/signin?next=${encodeURIComponent(safeNext(next))}`;

/** A normal link (open in new tab still works) that switches pages without reloading the app. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={click} {...rest} />;
}
