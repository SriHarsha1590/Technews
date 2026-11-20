# Guide 6: Deploy to a server

This puts the whole app on one Linux server with HTTPS. Everything runs in Docker; only ports 80/443 are open.

## What you need
- A server (2 vCPU / 4 GB RAM is plenty to start) with Docker and the Compose plugin.
- A domain whose DNS **A record** points at the server's IP.
- The Firebase, Gemini and notification keys from the earlier guides.

## Steps
1. Copy the project to the server (without `.env` and `node_modules`; `.dockerignore` already keeps them out of the images).
2. `cp .env.production.example .env.production`, then fill it in. Make the passwords with
   `openssl rand -base64 24 | tr -d '/+='`. Reuse your VAPID keys from `.env` (changing them drops everyone's notifications).
3. In Firebase: **Authentication → Settings → Authorized domains → Add domain** `your domain` (no `https://`).
4. Start it:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
   ```
5. Add the hourly digest schedule, once:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production exec worker npm run schedules -w @technews/worker
   ```
6. Open `https://your-domain`. Check `https://your-domain/api/v1/health` shows `"status":"ok"`.

## What protects it
- Mongo and Redis need passwords and are not reachable from outside the server. Temporal's UI is not published.
- Refresh is owner-only: `REFRESH_ADMIN_UIDS` (your Firebase user id) must be set, or Compose will not start.
- AI rate limits count per visitor (the API trusts one proxy, Caddy) and are shared between API copies through Redis.
- The API sets security headers (helmet); Caddy gets and renews the HTTPS certificate.
- Mongo is dumped daily to `./backups` (last 7 kept). **Copy that folder off the server** (rsync, S3) too.

## Scaling
- More readers: `up -d --scale api=3`. The API keeps no state.
- More pipeline throughput: `--scale worker=2`, and halve `LLM_CALLS_PER_SECOND` so the total stays under your Gemini quota.
- Past one server: use MongoDB Atlas, managed Redis and Temporal Cloud (set `MONGO_URL`/`REDIS_URL` and the
  `TEMPORAL_*` values, remove the `mongo`, `redis`, `temporal` services), and run `api`/`worker` on any container host.

## Not covered yet
- Error tracking and uptime monitoring: add a service such as Sentry and an uptime checker on `/api/v1/health`.
- The API and worker still run through `tsx` rather than compiled JavaScript. It works; compiling is a later optimisation.
