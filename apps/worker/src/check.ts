// Confirms a link still works and doesn't redirect somewhere we wouldn't trust.
import { USER_AGENT } from './config';

export interface CheckResult {
  ok: boolean;
  finalUrl?: string;
  reason?: string;
}

// Sites often block bots with 401/403/429 even though the page exists. Those prove the page is there;
// 404, 410 and 5xx do not.
const REACHABLE = (status: number) => (status >= 200 && status < 300) || status === 401 || status === 403 || status === 429;

export async function checkLink(
  url: string,
  isAllowed: (u: URL) => boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckResult> {
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    if (current.protocol !== 'https:' || !isAllowed(current)) {
      return { ok: false, reason: hop === 0 ? 'not an allowed site' : `redirects off the official site to ${current.hostname}` };
    }
    let res: Response;
    try {
      res = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': USER_AGENT } });
    } catch (err) {
      return { ok: false, reason: `unreachable (${(err as Error).message})` };
    }
    await res.body?.cancel().catch(() => {}); // we only need the status
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: `redirect ${res.status} without a location` };
      current = new URL(location, current);
      continue;
    }
    return REACHABLE(res.status) ? { ok: true, finalUrl: current.toString() } : { ok: false, reason: `HTTP ${res.status}` };
  }
  return { ok: false, reason: 'too many redirects' };
}
