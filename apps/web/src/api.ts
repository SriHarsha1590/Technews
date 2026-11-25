import type {
  ApiErrorBody,
  AskRequest,
  AskResponse,
  ExplainerView,
  FeedName,
  FeedResponse,
  HistoryFilter,
  HistoryPage,
  Me,
  MeStats,
  PopularTag,
  RefreshStatus,
  StoryPage,
  TryGuideView,
} from '@technews/shared';

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new ApiError(`The news server at ${API_URL} isn't responding.`, 'network');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(body?.error.message ?? `The news server returned an error (${res.status}).`, body?.error.code ?? 'http');
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// ---------- Public ----------

/** fresh: skip the browser's cached copy (after Refresh published new cards). */
export function fetchFeed(category: FeedName, cursor?: string, fresh = false): Promise<FeedResponse> {
  const params = new URLSearchParams({ category, limit: '20' });
  if (cursor) params.set('cursor', cursor);
  return request(`/feed?${params}`, fresh ? { cache: 'no-cache' } : {});
}

export const fetchExplainer = (id: string) => request<{ data: ExplainerView }>(`/stories/${id}/explainer`).then((r) => r.data);
export const fetchTryGuide = (id: string) => request<{ data: TryGuideView }>(`/stories/${id}/try-guide`).then((r) => r.data);
export const askQuestion = (body: AskRequest) =>
  request<{ data: AskResponse }>('/ask', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data);

export const fetchRefreshStatus = () => request<{ data: RefreshStatus }>('/refresh').then((r) => r.data);
export const startRefresh = (token: string) => request<{ data: RefreshStatus }>('/refresh', { method: 'POST' }, token).then((r) => r.data);

export const fetchPopularTags = () => request<{ data: PopularTag[] }>('/tags/popular').then((r) => r.data);
export const fetchPushKey = () => request<{ data: { publicKey: string } }>('/push/public-key').then((r) => r.data.publicKey);

// ---------- Signed-in reader ----------

const page = (cursor?: string) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

export const fetchMe = (token: string) => request<{ data: Me }>('/me', {}, token).then((r) => r.data);
export const fetchCapabilities = (token: string) => request<{ data: { admin: boolean } }>('/me/capabilities', {}, token).then((r) => r.data);
export const fetchAdmin = (token: string) => request<{ data: { mongo: boolean; redis: boolean; pipeline: Omit<RefreshStatus, 'feedVersion'>; feedVersion: number | null } }>('/me/admin', {}, token).then((r) => r.data);
export const fetchStory = (id: string) => request<{ data: import('@technews/shared').StoryDetail }>(`/stories/${encodeURIComponent(id)}`).then((r) => r.data);
export const fetchForYou = (token: string, cursor?: string) => request<StoryPage>(`/me/feed${page(cursor)}`, {}, token);
export const fetchSaved = (token: string, cursor?: string) => request<StoryPage>(`/me/bookmarks${page(cursor)}`, {}, token);
export const fetchSavedIds = (token: string) => request<{ data: string[] }>('/me/bookmarks/ids', {}, token).then((r) => r.data);
export const saveStory = (token: string, id: string) => request<void>(`/me/bookmarks/${id}`, { method: 'PUT' }, token);
export const unsaveStory = (token: string, id: string) => request<void>(`/me/bookmarks/${id}`, { method: 'DELETE' }, token);
export const putStack = (token: string, stack: string[]) =>
  request<{ data: { stack: string[] } }>('/me/stack', { method: 'PUT', body: JSON.stringify({ stack }) }, token);
export const putDigest = (token: string, digest: Me['digest']) =>
  request<{ data: Me['digest'] }>('/me/digest', { method: 'PUT', body: JSON.stringify(digest) }, token);
export const postPush = (token: string, sub: PushSubscriptionJSON) =>
  request<void>('/me/push', { method: 'POST', body: JSON.stringify(sub) }, token);
export const deletePush = (token: string, endpoint: string) =>
  request<void>('/me/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) }, token);

export const fetchStats = (token: string) => request<{ data: MeStats }>('/me/stats', {}, token).then((r) => r.data);
export const fetchReadIds = (token: string) => request<{ data: string[] }>('/me/history/ids', {}, token).then((r) => r.data);
export function fetchHistory(token: string, filter: HistoryFilter, cursor?: string): Promise<HistoryPage> {
  const params = new URLSearchParams({ filter });
  if (cursor) params.set('cursor', cursor);
  return request(`/me/history?${params}`, {}, token);
}
export const recordRead = (token: string, id: string, watched: boolean) =>
  request<void>(`/me/history/${id}`, { method: 'PUT', body: JSON.stringify({ watched }) }, token);
export const removeFromHistory = (token: string, id: string) => request<void>(`/me/history/${id}`, { method: 'DELETE' }, token);
export const clearHistory = (token: string) => request<void>('/me/history', { method: 'DELETE' }, token);
