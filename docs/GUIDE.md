# Build guide: Milestone 2, the news pipeline

This guide takes you from an empty machine to a running pipeline that collects tech news, groups the same
event across sites, writes 80-150 word summaries with AI, and publishes ranked feeds. Every step says what to
do, what it does, and how to check it worked.

---

## Step 1: Install the tools

| Tool | Version | Why we need it | Check |
|---|---|---|---|
| Node.js | 24.12 or newer | Runs all our TypeScript code | `node -v` |
| Docker + Docker Compose | Docker Desktop, or Engine on Linux | Runs MongoDB, Redis and Temporal without installing them | `docker compose version` |
| Git | any | Version control | `git --version` |

**Why Node 24.12+?** Our scripts use `--env-file-if-exists`, and current Firebase dependencies require Node 24.12+.

---

## Step 2: Get a free Gemini API key

1. Open https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it.

**What it's for:** the summarizer sends batches of 10 stories per request to Gemini Flash-Lite.
The free tier has per-minute and per-day limits, which Step 6 explains how we stay under.

---

## Step 3: Put the code in Git

```bash
unzip technews.zip && cd technews
git init && git add . && git commit -m "Milestone 2: news pipeline"
```

Optionally create an empty GitHub repo and push. **Why now:** every later milestone is a change you can
review and undo.

---

## Step 4: Understand the folder layout

```
technews/
├── package.json            npm workspaces: one install for every package
├── tsconfig.base.json      TypeScript settings shared by all packages
├── docker-compose.yml      MongoDB, Redis, Temporal for local development
├── .env.example            settings template (copy to .env)
├── packages/shared/src/
│   ├── types.ts            Source, Article, Story; categories; trust tiers
│   ├── summary.ts          zod schema that enforces the 80-150 word rule
│   └── feed.ts             ranking formula and Redis key names
└── apps/worker/src/
    ├── config.ts           every setting in one place
    ├── sources.ts          the curated list of 12 feeds, each with a trust tier
    ├── url.ts              cleans URLs and turns them into stable ids
    ├── cluster.ts          decides when two headlines are the same event
    ├── extract.ts          pulls readable text from a page when a feed item is too thin
    ├── db.ts               MongoDB and Redis connections, indexes
    ├── llm.ts              the only file that talks to Gemini (+ daily cost cap)
    ├── activities/         the real work (network, database, AI)
    │   ├── ingest.ts       fetch feeds -> articles
    │   ├── summarize.ts    articles -> stories with AI summaries
    │   └── feeds.ts        stories -> ranked lists in Redis
    ├── workflows.ts        the order of steps, retries, rate-limited AI queue
    ├── worker.ts           runs workflows and activities
    ├── schedules.ts        creates the every-5-min pipeline schedule (also run by the worker on startup)
    └── run-once.ts         triggers a workflow by hand
```

**Why a `shared` package?** The worker writes stories and (soon) the API reads them. If both import the
`Story` type from one place, changing it breaks the build in both, instead of breaking production.

---

## Step 5: Install dependencies

```bash
npm install
```

**What it does:** npm reads `"workspaces"` in the root `package.json`, installs everything once into the root
`node_modules`, and links `@technews/shared` so the worker can import it like any package.

---

## Step 6: Configure `.env`

```bash
cp .env.example .env
```

Open `.env` and paste your key after `GEMINI_API_KEY=`. Everything else already works locally:

| Setting | Default | What it controls |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Which model writes summaries. Google renames models; if you get "model not found", pick a current Flash-Lite id from the Gemini docs. |
| `LLM_CALLS_PER_SECOND` | `0.1` (6 per minute) | Temporal holds AI calls to this rate across all workers, safely under free-tier limits. |
| `WORKER_LLM_DAILY_CAP` | `800` | Daily worker allocation in Redis, reserved for scheduled ingestion. |
| `PUBLIC_LLM_DAILY_CAP` | `100` | Separate daily allocation for public AI features. Both allocations count against your Gemini quota. |

`.env` is in `.gitignore`, so your key never gets committed.

---

## Step 7: Start the infrastructure

```bash
docker compose up -d
docker compose ps          # all three should say "running"
```

| Service | Port | Role |
|---|---|---|
| mongo | 27017 | Source of truth: articles and stories |
| redis | 6379 | Ranked feed snapshots + AI call counter |
| temporal | 7233 (gRPC), 8233 (UI) | Schedules, retries, history of every run |

Open http://localhost:8233. You should see the Temporal UI with no workflows yet.

---

## Step 8: Run the checks

```bash
npm run typecheck
npm test
```

**What's tested without any servers:** URL cleaning, headline grouping, page text extraction, the 80-150
word rule, the ranking formula, and how AI output is sorted into good / insufficient / invalid.
All should pass before you go further.

---

## Step 9: Start the worker

```bash
npm run worker
```

Leave this terminal open. You should see:

```
Worker running. Queues: technews, llm (0.1 AI calls/sec, model gemini-3.1-flash-lite)
```

**What it does:** the worker connects to Temporal and waits for work on two queues:
- `technews`: workflows plus all normal activities (fetching, database).
- `llm`: only the AI call, with the rate limit applied.

---

## Step 10: Ingest the feeds once

In a second terminal:

```bash
npm run ingest
```

**What happens:** `ingestAllWorkflow` fetches all 12 feeds in parallel. Each item's URL is cleaned and hashed
into an id, so the same link is never saved twice. Articles are stored with `status: "new"`.

**Output:** a summary with `ok` (per-source counts), `failed` (feeds that errored after 3 tries) and
`totalInserted`. A failed feed usually means its URL changed: fix it in `sources.ts`.

**Check the data:**

```bash
docker compose exec mongo mongosh technews --quiet --eval '
  db.articles.aggregate([{ $group: { _id: "$trustTier", count: { $sum: 1 } } }])'
```

Run `npm run ingest` again: `totalInserted` should be 0 or close to it. That proves duplicates are skipped.

---

## Step 11: Summarize once

```bash
npm run summarize
```

This takes a few minutes the first time because AI calls are limited to 6 per minute. Here's what
`summarizeWorkflow` does, step by step:

1. **`loadPendingArticles`** takes up to 40 `new` articles, oldest first.
2. **`assignToStories`** checks each against stories from the last 48 hours. If it's the same event, the article
   is added to that story as another source **without an AI call**. If it comes from a more trusted source,
   it becomes the story's headline link.
3. **`groupByTitle`** groups the remaining articles that are about the same event.
4. **`buildContexts`** builds the text the AI will read. If a group's snippets are thin (like Hacker News links),
   it fetches the article page and extracts paragraphs. That text is used once and never stored.
5. **`summarizeGroups`** (on the `llm` queue) sends 10 groups per call. Gemini returns title, summary, tags and
   category for each.
6. **Validation:** every item is checked separately with zod. A summary outside 80-150 words is rejected and
   that article is retried next run (max 3 attempts). If the AI says the text is too thin to summarize honestly,
   the article is marked `skipped` instead of being padded with guesses.
7. **`saveStories`** writes the stories. This is a separate step on purpose: if saving fails, Temporal retries
   only the save, not the AI call.
8. **`rebuildFeeds`** scores recent stories and publishes new feed snapshots in Redis.

**Output:**

```json
{ "pending": 40, "attachedToExisting": 3, "newStories": 31, "capped": false, "feeds": { "all": 31, "ai": 9, ... } }
```

**Check the stories:**

```bash
docker compose exec mongo mongosh technews --quiet --eval '
  db.stories.find({}, { title: 1, sourceCount: 1, "primarySource.name": 1, summary: 1 })
    .sort({ score: -1 }).limit(3)'
```

Each story should have a clear title, a 80-150 word summary, and a `primarySource` from the most trusted tier
that covered it.

---

## Step 12: Look at the feeds in Redis

```bash
docker compose exec redis redis-cli GET feed:all:current
# prints a version, e.g. 1760870400000
docker compose exec redis redis-cli ZRANGE feed:all:v1760870400000 0 9 REV WITHSCORES
```

**What you're seeing:** the top 10 story ids with their scores. The API (next milestone) will read
these ids and load the matching cards from MongoDB. Each snapshot expires after 30 minutes. That's long enough
for someone to keep scrolling a consistent list while newer snapshots replace it.

---

## Step 13: Turn on the schedules

```bash
npm run schedules
```

The worker also does this on startup, so this step is optional. It creates (or updates) two Temporal schedules:
- `pipeline` every 5 minutes: runs `refreshWorkflow` (ingest -> summarize -> images -> Try it links -> re-rank),
- `recheck-try-links` once a day.

Older schedules from earlier steps (`ingest-all`, `summarize`, `try-links`) are deleted, since `pipeline` does their work.

`overlap: SKIP` means that if a run is still going when the next is due, the new one is skipped, never stacked.
You can pause or trigger them from the **Schedules** page in the Temporal UI.

---

## Step 14: Watch it in the Temporal UI

Open http://localhost:8233, then **Workflows**, and click any run. You'll see each activity, its input and
output, how long it took, and any retries. This is where you look first when something seems wrong.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GEMINI_API_KEY is not set` | `.env` missing or empty | Step 6 |
| AI calls failing with 404 / model not found | Model id renamed | Set a current Flash-Lite id in `GEMINI_MODEL` |
| AI calls retrying with 429 | Free-tier limit hit | Lower `LLM_CALLS_PER_SECOND`; Temporal backs off and retries automatically |
| `capped: true` in summarize output | Daily cap reached | Normal; remaining articles wait until tomorrow (UTC) |
| A source always in `failed` | Feed URL changed or site blocks bots | Open the URL in a browser; update or remove it in `sources.ts` |
| Worker can't connect to 7233 | Temporal container not up | `docker compose ps`, then `docker compose logs temporal` |
| Many articles `skipped` | Feed gives only headlines and the page blocks fetching | Expected for some sources; they still appear if a richer source covers the same event |

---

## What's next: Milestone 3

The API (`apps/api`) reads these Redis snapshots and MongoDB stories to serve `GET /feed`, and the web app
(`apps/web`) shows them as the card from the sketch: headline linking to the trusted source, summary, and the
Try it / Video / Chat buttons.
