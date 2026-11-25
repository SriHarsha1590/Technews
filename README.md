# TechNews

Short, trustworthy tech news cards, with a **Try it** button that actually works.

Each card has a headline linking to the most trusted source, an 80-150 word summary, and three buttons:

- **Try it**: verified official links and AI-written steps (steps are never links).
- **Watch**: a 30-60 second explainer using the article image and the browser's own free voice.
- **Ask**: a chatbot that answers news questions only from the stories on screen, and explains tech words in plain language.

Readers can sign in to save stories, see their reading history, and get a push digest.

**New here? Follow [docs/GUIDE.md](docs/GUIDE.md) step by step.**

## Quick start

Requires Node 24.12+ and Docker.

```bash
cp .env.example .env              # add your GEMINI_API_KEY
npm install
docker compose up -d              # MongoDB, Redis, Temporal (UI: http://localhost:8233)
npm run worker                    # keep running: it also sets up the 5-minute pipeline schedule
npm run api                       # API on http://localhost:4000
npm run web                       # web app (Vite dev server)
npm run refresh                   # optional: run the pipeline once right now
```

While the worker is running, the `pipeline` schedule runs `refreshWorkflow` **every 5 minutes**:
ingest every feed -> group -> summarize -> card images -> Try it links -> re-rank. The web app does not poll:
new cards appear when the page is reloaded or when a reader presses **Refresh stories**. That button checks for cards the pipeline has already published; it does not start another pipeline run.

The admin dashboard's **Run news pipeline** button does the same as `npm run refresh`: it starts
`refreshWorkflow` through the API (`POST /api/v1/refresh`). In production, only the user ids in
`REFRESH_ADMIN_UIDS` can start that run because it fetches sources and spends AI quota. If a run is
already active, the dashboard follows its status and does not start another one.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run worker` | Start the Temporal worker |
| `npm run api` / `npm run web` | Start the API / web dev server |
| `npm run refresh` | Run the full pipeline once |
| `npm run ingest` / `summarize` / `try-links` / `digest` | Run a single pipeline step once |
| `npm run schedules` | Register the schedules (hourly digest) |
| `npm test` / `npm run typecheck` | Tests / type checks in every workspace
| `npm run lint` / `npm run format:check` / `npm run coverage` | Static checks and coverage gate |

## Layout

```
packages/shared   types, zod schemas, ranking formula (used by every app)
apps/worker       Temporal workflows: ingest -> group -> summarize -> rank
apps/api          Express API
apps/web          React PWA
deploy/           Caddy and Nginx configs
docs/             step-by-step guides
```

## Docs

- [GUIDE.md](docs/GUIDE.md): setup from scratch
- [02-api.md](docs/02-api.md), [03-web.md](docs/03-web.md): API and web app
- [04-try-it.md](docs/04-try-it.md): how Try it links are verified
- [05-accounts.md](docs/05-accounts.md): sign-in (Firebase) and push notifications
- [06-deploy.md](docs/06-deploy.md): deploy to AWS EC2 or another Linux server with HTTPS

## Status

- [x] Monorepo + shared types
- [x] Ingestion from ~50 curated English-language feeds with trust tiers
- [x] Grouping the same event across sources
- [x] AI summaries (80-150 words, enforced), with daily cost cap and rate limit
- [x] Ranked feed snapshots in Redis
- [x] API + card UI
- [x] Try it, Ask and Watch on every card
- [x] Sign-in, bookmarks, history, push digest
- [x] Production deployment configuration (Docker Compose, Caddy HTTPS, off-host Mongo backups)
- [ ] Live EC2 deployment, restore drill, and alert delivery verified
