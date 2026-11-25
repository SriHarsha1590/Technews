// Confirms an exact link with the shared network boundary. Every redirect is
// resolved, checked against the trust rule, and pinned to a public IP.
import { safeFetchStatus, type SafeFetchOptions } from '@technews/shared/safe-fetch';
import { USER_AGENT } from './config';

export interface CheckResult {
  ok: boolean;
  finalUrl?: string;
  reason?: string;
}

type StatusCheck = (url: string, options: SafeFetchOptions) => Promise<{ status: number; finalUrl: string } | null>;

export async function checkLink(
  url: string,
  isAllowed: (u: URL) => boolean,
  check: StatusCheck = safeFetchStatus,
): Promise<CheckResult> {
  try {
    const initial = new URL(url);
    if (initial.protocol !== 'https:' || !isAllowed(initial)) return { ok: false, reason: 'not an allowed site' };
    const result = await check(url, { userAgent: USER_AGENT, timeoutMs: 10_000, isAllowed });
    if (!result || !isAllowed(new URL(result.finalUrl))) return { ok: false, reason: 'unreachable or unsafe destination' };
    return result.status >= 200 && result.status < 300
      ? { ok: true, finalUrl: result.finalUrl }
      : { ok: false, reason: `HTTP ${result.status}` };
  } catch (error) {
    return { ok: false, reason: `unreachable (${error instanceof Error ? error.message : String(error)})` };
  }
}
