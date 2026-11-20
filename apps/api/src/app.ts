import helmet from 'helmet';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import cors from 'cors';
import { z, ZodError } from 'zod';
import {
  AskRequest,
  DigestUpdate,
  FeedQuery,
  HistoryQuery,
  HistoryUpdate,
  PageQuery,
  PushSubscriptionBody,
  RETENTION_DAYS,
  StackUpdate,
  StoryIdParam as StoryId,
  type ApiErrorBody,
  type FeedResponse,
  type HistoryPage,
  type RefreshStatus,
  type StoryPage,
} from '@technews/shared';
import type { FeedStore, StoryStore } from './stores';
import type { UserStore } from './users';
import { getFeedPage } from './feed';
import { BadCursorError } from './cursor';
import { AuthError, bearerToken, type VerifyToken } from './auth';
import { CACHE } from './config';
import { AiUnavailable } from './ai';
import { ask, getExplainer, getTryGuide, type AssistDeps } from './assist';
import { RefreshUnavailable, type Refresher } from './refresh';

export interface Deps {
  feeds: FeedStore;
  stories: StoryStore;
  users: UserStore;
  verify: VerifyToken;
  assist: AssistDeps;
  refresher: Refresher;
  webOrigins: string[];
  vapidPublicKey: string;
  aiRequestsPerMinute?: number;
  /** Number of reverse proxies in front of the API (Nginx, Cloudflare, a load balancer). 0 when reachable directly. */
  trustProxy?: number;
  /** Who may start a Refresh. Empty: any signed-in reader. */
  refreshAdminUids?: string[];
  /** Counts a hit for `key` in the current minute across all API instances (e.g. Redis). Absent or failing: per-process counting. */
  sharedCounter?: (key: string) => Promise<number>;
}

const PAGE_SIZE = 20;
const FOR_YOU_DAYS = 30; // "catch up": everything in your stack from the last month
const DAY = 86_400_000;
const READ_IDS_MAX = 2000; // the feed only holds RETENTION_DAYS of stories, so older reads can't be in it

function sendError(res: Response, status: number, code: string, message: string, details?: ApiErrorBody['error']['details']) {
  const body: ApiErrorBody = { error: { code, message, ...(details ? { details } : {}) } };
  res.status(status).set('Cache-Control', 'no-store').json(body);
}

/** Fixed one-minute window per caller (the IP). Shared across API instances when `shared` works, else per process. */
function perMinuteLimit(max: number, shared?: (key: string) => Promise<number>): RequestHandler {
  const hits = new Map<string, { windowStart: number; count: number }>();
  const local = (key: string, now: number) => {
    const h = hits.get(key);
    if (!h || now - h.windowStart >= 60_000) {
      if (hits.size > 10_000) hits.clear(); // never grows without bound
      hits.set(key, { windowStart: now, count: 1 });
      return { count: 1, retryAfter: 60 };
    }
    return { count: ++h.count, retryAfter: Math.ceil((h.windowStart + 60_000 - now) / 1000) };
  };
  return async (req, res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    let result: { count: number; retryAfter: number };
    try {
      result = shared ? { count: await shared(key), retryAfter: 60 - Math.floor((now % 60_000) / 1000) } : local(key, now);
    } catch {
      result = local(key, now); // Redis down: still protect the quota, per process
    }
    if (result.count > max) {
      res.set('Retry-After', String(result.retryAfter));
      return sendError(res, 429, 'rate_limited', 'Too many requests. Wait a moment and try again.');
    }
    next();
  };
}

/** Reads `limit + 1` items: if the extra one exists there is a next page. */
function page(items: StoryPage['data'], offset: number): StoryPage {
  return {
    data: items.slice(0, PAGE_SIZE),
    meta: { nextCursor: items.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null },
  };
}

export function createApp({ feeds, stories, users, verify, assist, refresher, webOrigins, vapidPublicKey, aiRequestsPerMinute = 20, trustProxy = 0, refreshAdminUids = [], sharedCounter }: Deps) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy > 0) app.set('trust proxy', trustProxy); // so req.ip is the visitor, not the proxy
  app.use(helmet());
  app.use(
    cors({
      origin: webOrigins,
      methods: ['GET', 'PUT', 'POST', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
    }),
  );
  app.use(express.json({ limit: '64kb' })); // Ask sends up to 100 story ids and the last few messages

  const v1 = express.Router();
  const aiLimit = perMinuteLimit(aiRequestsPerMinute, sharedCounter);

  // ---------- Public ----------

  v1.get('/health', async (_req, res) => {
    const [mongo, redis] = await Promise.all([stories.ping(), feeds.ping()]);
    // Redis down is "degraded", not "down": the feed still works from MongoDB.
    res.status(mongo ? 200 : 503).set('Cache-Control', 'no-store').json({ status: mongo ? (redis ? 'ok' : 'degraded') : 'down', mongo, redis });
  });

  v1.get('/feed', async (req, res) => {
    const query = FeedQuery.parse(req.query);
    const result = await getFeedPage(query, feeds, stories);
    const body: FeedResponse = { data: result.cards, meta: { nextCursor: result.nextCursor, servedFrom: result.servedFrom } };
    res.set('Cache-Control', result.cacheControl).json(body);
  });

  v1.get('/stories/:id', async (req, res) => {
    const id = StoryId.parse(req.params.id);
    const story = await stories.detail(id);
    if (!story) return sendError(res, 404, 'not_found', 'Story not found');
    res.set('Cache-Control', CACHE.story).json({ data: story });
  });

  // Watch: made by the AI on first view, then saved.
  v1.get('/stories/:id/explainer', aiLimit, async (req, res) => {
    const explainer = await getExplainer(StoryId.parse(req.params.id), assist);
    if (!explainer) return sendError(res, 404, 'not_found', 'Story not found');
    res.set('Cache-Control', CACHE.generated).json({ data: explainer });
  });

  // Try it steps: made by the AI on first view, then saved.
  v1.get('/stories/:id/try-guide', aiLimit, async (req, res) => {
    const guide = await getTryGuide(StoryId.parse(req.params.id), assist);
    if (!guide) return sendError(res, 404, 'not_found', 'Story not found');
    res.set('Cache-Control', CACHE.generated).json({ data: guide });
  });

  // Ask: answers only from the cards the reader has on screen.
  v1.post('/ask', aiLimit, async (req, res) => {
    const answer = await ask(AskRequest.parse(req.body ?? {}), assist);
    res.set('Cache-Control', 'no-store').json({ data: answer });
  });

  // Refresh: start the scrape -> summarize -> Try it pipeline now. Rate limited because it spends AI calls.
  // feedVersion lets the web app show each batch of new cards as soon as the worker publishes it.
  const feedVersion = () => feeds.currentVersion('all').catch(() => null);

  // Starting a run spends AI quota, so it needs a signed-in reader (and, if REFRESH_ADMIN_UIDS is set, one of those).
  v1.post('/refresh', async (req, res, next) => {
    const token = bearerToken(req.header('authorization'));
    if (!token) return sendError(res, 401, 'unauthorized', 'Sign in to refresh the feed');
    const { uid } = await verify(token);
    if (refreshAdminUids.length && !refreshAdminUids.includes(uid)) return sendError(res, 403, 'forbidden', 'You are not allowed to refresh the feed');
    next();
  }, aiLimit, async (_req, res) => {
    const data: RefreshStatus = { ...(await refresher.start()), feedVersion: await feedVersion() };
    res.status(202).set('Cache-Control', 'no-store').json({ data });
  });

  v1.get('/refresh', async (_req, res) => {
    const data: RefreshStatus = { ...(await refresher.status()), feedVersion: await feedVersion() };
    res.set('Cache-Control', 'no-store').json({ data });
  });

  v1.get('/tags/popular', async (_req, res) => {
    const tags = await stories.popularTags(new Date(Date.now() - FOR_YOU_DAYS * DAY), 40);
    res.set('Cache-Control', CACHE.tags).json({ data: tags });
  });

  v1.get('/push/public-key', (_req, res) => {
    if (!vapidPublicKey) return sendError(res, 503, 'push_not_configured', 'Notifications are not set up on this server');
    res.set('Cache-Control', CACHE.tags).json({ data: { publicKey: vapidPublicKey } });
  });

  // ---------- Signed-in reader ----------

  const me = express.Router();

  // Every /me route needs a valid Firebase ID token: "Authorization: Bearer <token>".
  me.use(async (req: Request, res: Response, next: NextFunction) => {
    const token = bearerToken(req.header('authorization'));
    if (!token) return sendError(res, 401, 'unauthorized', 'Sign in to use this');
    res.locals.uid = (await verify(token)).uid;
    res.set('Cache-Control', CACHE.private);
    next();
  });
  const uidOf = (res: Response) => res.locals.uid as string;

  me.get('/', async (_req, res) => {
    res.json({ data: await users.me(uidOf(res)) });
  });

  me.put('/stack', async (req, res) => {
    const { stack } = StackUpdate.parse(req.body);
    await users.setStack(uidOf(res), stack);
    res.json({ data: { stack } });
  });

  me.put('/digest', async (req, res) => {
    const digest = DigestUpdate.parse(req.body);
    await users.setDigest(uidOf(res), digest);
    res.json({ data: digest });
  });

  me.get('/feed', async (req, res) => {
    const offset = Number(PageQuery.parse(req.query).cursor ?? 0);
    const { stack } = await users.me(uidOf(res));
    const cards = await stories.byTags(stack, new Date(Date.now() - FOR_YOU_DAYS * DAY), offset, PAGE_SIZE + 1);
    res.json(page(cards, offset));
  });

  me.get('/bookmarks/ids', async (_req, res) => {
    res.json({ data: await users.bookmarkIds(uidOf(res), 500) });
  });

  me.get('/bookmarks', async (req, res) => {
    const offset = Number(PageQuery.parse(req.query).cursor ?? 0);
    const ids = await users.bookmarkPage(uidOf(res), offset, PAGE_SIZE + 1);
    const cards = await stories.cardsByIds(ids);
    // A saved story that has since been deleted is skipped; the page size comes from the ids.
    res.json({ data: cards.slice(0, PAGE_SIZE), meta: { nextCursor: ids.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null } });
  });

  me.put('/bookmarks/:storyId', async (req, res) => {
    const storyId = StoryId.parse(req.params.storyId);
    if (!(await stories.cardsByIds([storyId])).length) return sendError(res, 404, 'not_found', 'Story not found');
    await users.addBookmark(uidOf(res), storyId); // saving twice is fine
    res.status(204).end();
  });

  me.delete('/bookmarks/:storyId', async (req, res) => {
    await users.removeBookmark(uidOf(res), StoryId.parse(req.params.storyId));
    res.status(204).end();
  });

  // History: what the reader opened or watched. The feed hides these until the reader removes them here.
  me.get('/stats', async (_req, res) => {
    res.json({ data: await users.stats(uidOf(res)) });
  });

  me.get('/history/ids', async (_req, res) => {
    const since = new Date(Date.now() - (RETENTION_DAYS + 1) * DAY);
    res.json({ data: await users.readIds(uidOf(res), since, READ_IDS_MAX) });
  });

  me.get('/history', async (req, res) => {
    const { cursor, filter } = HistoryQuery.parse(req.query);
    const offset = Number(cursor ?? 0);
    const entries = await users.historyPage(uidOf(res), filter, offset, PAGE_SIZE + 1);
    const body: HistoryPage = {
      data: entries.slice(0, PAGE_SIZE),
      meta: { nextCursor: entries.length > PAGE_SIZE ? String(offset + PAGE_SIZE) : null },
    };
    res.json(body);
  });

  me.put('/history/:storyId', async (req, res) => {
    const storyId = StoryId.parse(req.params.storyId);
    const { watched } = HistoryUpdate.parse(req.body ?? {});
    const [story] = await stories.cardsByIds([storyId]);
    if (!story) return sendError(res, 404, 'not_found', 'Story not found');
    await users.recordRead(uidOf(res), story, watched);
    res.status(204).end();
  });

  me.delete('/history/:storyId', async (req, res) => {
    await users.removeHistory(uidOf(res), StoryId.parse(req.params.storyId));
    res.status(204).end();
  });

  me.delete('/history', async (_req, res) => {
    await users.clearHistory(uidOf(res));
    res.status(204).end();
  });

  me.post('/push', async (req, res) => {
    await users.savePush(uidOf(res), PushSubscriptionBody.parse(req.body));
    res.status(204).end();
  });

  me.delete('/push', async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await users.removePush(uidOf(res), endpoint);
    res.status(204).end();
  });

  v1.use('/me', me);
  app.use('/api/v1', v1);
  app.use((_req, res) => sendError(res, 404, 'not_found', 'Route not found'));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return sendError(res, 400, 'validation_error', 'Request validation failed',
        err.issues.map((i) => ({ field: i.path.join('.') || 'input', message: i.message })));
    }
    if (err instanceof AuthError) return sendError(res, err.code === 'unauthorized' ? 401 : 503, err.code, err.message);
    if (err instanceof BadCursorError) return sendError(res, 400, 'bad_cursor', 'Cursor is invalid; reload the feed from the top');
    if (err instanceof AiUnavailable) return sendError(res, 503, 'ai_unavailable', err.message);
    if (err instanceof RefreshUnavailable) return sendError(res, 503, 'refresh_unavailable', err.message);
    if (err?.type === 'entity.parse.failed') return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
    if (err?.type === 'entity.too.large') return sendError(res, 413, 'too_large', 'Request body is too large');
    console.error(err);
    sendError(res, 500, 'internal_error', 'Something went wrong'); // never leak internals
  };
  app.use(onError);
  return app;
}
