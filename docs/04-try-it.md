# Guide 4: Try it, part 1 (verified official links)

The **Try it** button opens a sheet with up to four ways to start using what the story is about:

| Option | Shown as | Example |
|---|---|---|
| playground | Try it online | platform.openai.com/playground, a Hugging Face Space |
| download | Download | chatgpt.com/download |
| repo | View the code | github.com/openai/astra |
| docs | Read the docs | the getting-started guide |

Every link is **copied from a source page** and **verified by code** before anyone sees it. If nothing passes,
the button stays disabled. That's on purpose: a missing link is better than a fake download page.
The sheet also shows AI-written steps based on the article. Readers should check those steps against official docs.

---

## Step 1: The pipeline

The pipeline's `refreshWorkflow` finds Try it links for new and recently missed stories every 5 minutes:

1. **`loadStoriesNeedingTryLinks`** takes up to 15 stories from the last 72 hours that haven't been searched yet.
2. **`collectLinkCandidates`** fetches up to two source pages per story (official ones first) and pulls out
   every link in the article body (`links.ts`). Navigation, footers, share buttons, privacy pages and non-https
   links are dropped. Links that could never pass the trust rules (Step 2) are dropped here too.
3. **Stories with no candidates** are marked as searched, without an AI call.
4. **`classifyTryLinks`** (rate-limited `llm` queue) sends 5 stories per AI call. Each story's links are
   numbered, and the AI answers only with **numbers and types**, for example `{"link": 3, "type": "playground"}`.
   It never writes a URL, so it can't invent one.
5. **`verifyAndSaveTryLinks`** checks every pick in code (Steps 2 and 3) and saves the ones that pass in
   `story.tryLinks`. If the AI's first choice for a type fails, its next choice for that type is tried.

A second workflow, `recheckTryLinksWorkflow`, runs daily and re-checks any link last checked more than
7 days ago. Dead links, or links that now redirect to another site, are removed.

---

## Step 2: The trust rules (`trust.ts`)

These rules are the safety boundary. The AI suggests; code decides.

1. **https only.**
2. **Found on an official page** (e.g. OpenAI's own announcement): the link must stay on that company's own
   sites. Each official source lists them in `sources.ts` as `ownDomains`, e.g. GitHub owns `github.blog` and
   `github.com`, Google owns `blog.google`, `google.com`, `google.dev`, `deepmind.google`.
3. **Code hosts** (github.com, gitlab.com, huggingface.co, npmjs.com, pypi.org) host user content. Only
   known vendor namespaces are accepted for code, playgrounds and docs, and never for downloads.
4. **Found on a press or community page:** allowed only to a known vendor's own site (any official source's
   `ownDomains`) or a known vendor namespace on a code host, and **never as a download**.

Sites are compared by their **registrable domain** using the `tldts` library: `docs.github.com` belongs to
`github.com`, while `openai.com.evil.io` belongs to `evil.io` and `openai-download.com` is its own site.
Both lookalikes are rejected; there are tests for exactly these cases.

**Known limitation:** a startup covered only by TechCrunch gets no Try it links, because nothing proves which
site is theirs. Adding their blog as an official source (with `ownDomains`) fixes that for them.

---

## Step 3: The link check (`check.ts`)

1. Request the link without following redirects automatically.
2. If it redirects, check the new address against the same trust rules, then follow it (up to 5 hops).
   A redirect from an official page to another site fails the check.
3. **Passes:** only 2xx responses from the trusted destination.
4. **Fails:** 401/403/429, 404, 410, 5xx, timeouts, unsafe DNS answers, too many redirects.

The saved URL is where the redirects ended, and `domain` is what the sheet shows ("Opens platform.openai.com").

---

## Step 4: What the API and web app show

- `GET /feed` cards now include `tryLinks: [{ type, url, domain, checkedAt }]`. The link text and internal
  fields stay on the server. Stories saved before this milestone return `[]`.
- **Try it** is enabled when a story has at least one link. It opens a sheet, a bottom sheet on phones and a
  centered panel on desktop, listing the options with the most direct first (playground, then download, repo,
  docs). Each shows where it goes and when it was last checked.
- The sheet is a native `<dialog>`: Escape, tapping outside, and the Close button all close it, and keyboard
  focus stays inside while it's open.

---

## Step 5: Install and run the checks

```bash
npm install
npm run typecheck
npm test
```

The suite should pass; test counts change as checks are added.

New worker tests cover the trust rules (official, press, code hosts, lookalike domains, http), link
extraction, the link check (redirects on and off site, successful vs bot-blocked pages) and pick verification
(fallback to the next pick, numbers the AI made up).

---

## Step 6: Run it on your data

Restart the worker so it loads the new workflows (Ctrl+C, then `npm run worker`). Then:

```bash
npm run try-links
```

Example output:

```json
{ "searched": 15, "withoutCandidates": 6, "withLinks": 5, "capped": false }
```

- `withoutCandidates`: pages had no usable links (common for community posts and some news articles).
- `withLinks`: stories that now have at least one verified link.

Run it a few times; each run takes the next 15 unsearched stories. Then add the new schedules:

```bash
npm run schedules
```

The worker already ensures the `pipeline` schedule (every 5 minutes) and `recheck-try-links` (daily) on startup.

**See what was saved:**

```bash
docker compose exec mongo mongosh technews --quiet --eval '
  db.stories.find({ "tryLinks.0": { $exists: true } }, { title: 1, tryLinks: 1 }).limit(3)'
```

**See what was rejected and why:** open the Temporal UI, find a `tryLinksWorkflow` run and check the worker
terminal for `try link rejected` lines with a reason such as `HTTP 404` or `redirects off the official site`.

---

## Step 7: Check it in the app

With `npm run api` and `npm run web` running, scroll to a story from an official source (OpenAI, Google, GitHub,
Hugging Face). Its **Try it** button should be enabled. Tap it and open each option.

**End-to-end tests** (now 9 scenarios on 2 screens = 18):

```bash
npm run e2e -w @technews/web
```

The new scenario checks that Try it opens the sheet, lists the playground first, links safely in a new tab,
shows the domain and check time, and closes with Escape and with the Close button.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `withLinks` is always 0 | Source pages block our fetcher, or articles don't link to products | Check the worker log; official blogs usually work best |
| A good link was rejected as "not an allowed site" | The company owns a domain missing from `ownDomains` | Add it to that source in `sources.ts`, then re-run |
| A story was searched before its official post arrived | Stories are searched once | Later coverage is attached to the story, but links aren't re-searched yet (planned) |
| Try it disabled on older stories | Saved before this milestone | `npm run try-links` searches stories from the last 72 hours |
| `capped: true` | Worker AI cap reached | Waits until tomorrow; review `WORKER_LLM_DAILY_CAP` and usage before raising it |
