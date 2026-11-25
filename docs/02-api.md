# Guide 2: The API

The API is the only thing the web app talks to. It reads the ranked snapshots the worker writes to Redis,
loads the matching stories from MongoDB, and returns them as cards. This guide assumes Guide 1 is done and
`npm run summarize` has created some stories.

---

## Step 1: What the API offers

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/feed?category=ai&limit=20&cursor=...` | The next page of cards, ranked |
| `GET /api/v1/stories/:id` | One story with every source that covered it |
| `GET /api/v1/health` | Whether MongoDB and Redis are reachable |
| `GET /api/v1/metrics` | Operational counters and feed freshness for monitoring |

**Why `/api/v1`:** if we ever change the response shape, we can add `/api/v2` without breaking app versions
people already have installed.

`category` is one of `all, ai, dev, cloud, security, research, general`. `limit` is 1-50 (default 20).

---

## Step 2: Understand the files

```
apps/api/src/
├── config.ts     port, connection URLs, allowed web origins, cache times
├── cursor.ts     encodes "which snapshot + where you stopped" into an opaque string
├── stores.ts     FeedStore (Redis) and StoryStore (MongoDB) behind small interfaces
├── feed.ts       the paging logic: snapshot -> expired snapshot -> MongoDB fallback
├── app.ts        Express routes, input validation, error format, CORS
├── server.ts     connects to MongoDB/Redis and starts listening
└── app.test.ts   8 tests using in-memory fakes, no databases needed
```

The shared contract (`StoryCard`, `FeedResponse`, `FeedQuery`) lives in `packages/shared/src/api.ts`, so the
web app will use exactly the same types.

**Why interfaces in `stores.ts`?** Routes only see `FeedStore` and `StoryStore`. Tests pass in fakes, so they
run in milliseconds without MongoDB or Redis. Production passes in the real ones.

---

## Step 3: How a feed request is answered

`getFeedPage` in `feed.ts`:

1. **Validate** `category`, `limit` and `cursor` with zod. Bad input gets a `400`.
2. **Pick the snapshot.** No cursor: read `feed:<category>:current` to get the newest version.
   With a cursor: use the version inside it, so page 2 comes from the same list as page 1.
3. **Read `limit + 1` ids** from that snapshot. If the extra id exists, there is a next page.
   That way we know without counting the whole list.
4. **Snapshot expired?** (cursors older than 30 minutes) Continue from the newest snapshot at the same
   position instead of failing.
5. **Load the cards** from MongoDB in one `$in` query and put them back in Redis's order.
6. **Redis down or empty?** Rank directly from MongoDB using the `score` the worker saves there.
   `meta.servedFrom` says which path was used.
7. **Set `Cache-Control`** so browsers and Cloudflare can reuse responses:

| Response | Header | Why |
|---|---|---|
| First page | `public, max-age=120` | Picks up new snapshots within 2 minutes |
| Later pages | `public, max-age=600` | A pinned snapshot never changes |
| MongoDB fallback | `public, max-age=30` | Try Redis again soon |
| Errors | `no-store` | Never cache a failure |

---

## Step 4: Errors always look the same

```json
{ "error": { "code": "validation_error", "message": "Request validation failed",
             "details": [{ "field": "category", "message": "Invalid option: expected one of ..." }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Unknown category, limit out of range, malformed story id |
| 400 | `bad_cursor` | Cursor was edited or corrupted; the app should reload from the top |
| 404 | `not_found` | Unknown story or route |
| 500 | `internal_error` | Anything unexpected; details go to the server log, never to the client |

**Why one shape:** the web app needs one error handler, not one per endpoint.

---

## Step 5: Add the API settings to `.env`

Your `.env` from Guide 1 needs two new lines (they're in `.env.example`):

```
API_PORT=4000
WEB_ORIGINS=http://localhost:5173
```

`WEB_ORIGINS` is the CORS allowlist: only these sites may call the API from a browser. `5173` is where the web
app will run in the next milestone. Add your real domain here when you deploy.

The new `.env.example` also has `MONGO_PORT`, `REDIS_PORT`, `TEMPORAL_PORT` and `TEMPORAL_UI_PORT`. If you moved
Redis to 6380 earlier, set `REDIS_PORT=6380` there and remove the edit you made by hand in `docker-compose.yml`
(the new compose file reads the port from `.env`).

---

## Step 6: Install and run the checks

```bash
npm install
npm run typecheck
npm test
```

The suite should pass; test counts change as checks are added.

The API tests cover: Redis rank order, page 2 staying on its snapshot after a newer one is published, the last
page, expired snapshots, MongoDB fallback with Redis down, input errors, story detail, and CORS.

---

## Step 7: Start the API

Make sure `docker compose up -d` is running and the worker has produced stories, then:

```bash
npm run api
```

You should see `API listening on http://localhost:4000/api/v1`. It restarts automatically when you edit a file.

---

## Step 8: Try every endpoint

**Health:**
```bash
curl http://localhost:4000/api/v1/health
```
Expect `{"status":"ok","mongo":true,"redis":true}`.

**First page of the AI feed:**
```bash
curl -i "http://localhost:4000/api/v1/feed?category=ai&limit=3"
```
Check that `servedFrom` is `redis`, the `Cache-Control` header is `public, max-age=120`, and `nextCursor` is set
if there are more than 3 AI stories.

**Second page:** copy `nextCursor` from the response:
```bash
curl "http://localhost:4000/api/v1/feed?category=ai&limit=3&cursor=PASTE_IT_HERE"
```

**One story:** copy an `id` from the feed:
```bash
curl "http://localhost:4000/api/v1/stories/PASTE_ID_HERE"
```
The `sources` list shows every site that covered it. `primaryUrl` is the headline link.

**See the fallback work:** stop Redis with `docker compose stop redis`, request the feed again, and
`servedFrom` becomes `mongo`. Health says `degraded`. Start it again with `docker compose start redis`.

**See validation:**
```bash
curl "http://localhost:4000/api/v1/feed?category=sports"
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `data` is empty | No stories yet, or none in that category | Run `npm run summarize`; try `category=all` |
| `servedFrom: "mongo"` with Redis running | No snapshot yet | Run `npm run summarize` (it rebuilds feeds at the end) |
| `EADDRINUSE :4000` | Port taken | Change `API_PORT` in `.env` |
| API exits with a MongoDB connection error | Mongo not running or wrong `MONGO_URL` | `docker compose ps`; check the port matches `MONGO_PORT` |
| Browser shows a CORS error later | Web app origin not allowed | Add it to `WEB_ORIGINS` |

---

## What's next

Guide 3 builds the web app (`apps/web`): the card from your sketch, infinite scroll over `/feed`, category tabs,
and the headline opening the trusted source.
