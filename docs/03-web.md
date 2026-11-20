# Guide 3: The web app

The web app shows one story per screen, like Way2News: who reported it, a headline that opens the trusted
source, the 80-150 word summary, how many sources covered it, and the Try it / Watch / Ask buttons from the
original sketch. This guide assumes Guides 1 and 2 are done and the API is running.

---

## Step 1: Understand the files

```
apps/web/
├── index.html               page shell, favicon, mobile viewport settings
├── vite.config.ts           dev server on port 5173 (must match WEB_ORIGINS in .env)
├── playwright.config.ts     end-to-end tests on a phone and a desktop screen
├── e2e/feed.spec.ts         8 scenarios, run on both screens
└── src/
    ├── main.tsx             starts React, loads fonts and styles, sets up data fetching
    ├── App.tsx              top bar + feed; keeps the category in the URL (?category=ai)
    ├── api.ts               calls GET /feed and turns failures into readable messages
    ├── format.ts            "3h ago", "Official source", "Covered by 4 sources"
    ├── styles.css           colors, type, layout, light and dark themes
    └── components/
        ├── CategoryTabs.tsx All, AI, Dev, Cloud, Security, Research, General
        ├── Feed.tsx         snapping scroll, infinite loading, loading/empty/error/end states
        └── StoryCard.tsx    one card
```

The card's data type, `StoryCard`, comes from `packages/shared`, the same type the API returns. If the API's
response shape changes, the web app stops compiling until it's updated.

---

## Step 2: How the feed works

1. **Fetching:** TanStack Query's `useInfiniteQuery` calls `GET /feed?category=...&limit=20`. Each response
   carries `nextCursor`, which becomes the request for the next page.
2. **Snapping:** the feed uses CSS `scroll-snap-type: y mandatory`. Each card is at least one screen tall and
   snaps into place, so readers move one story at a time.
3. **Infinite scroll:** an invisible marker after the last card is watched with `IntersectionObserver`. When
   it comes within about two screens, the next page loads, before the reader reaches the end.
4. **Caching:** each category's pages are kept for a minute, so switching from AI to Dev and back is instant.
5. **Category in the URL:** picking AI changes the address to `?category=ai`, so a link opens the same feed.
6. **States:** "Loading stories…", an empty-category message, an error message with Try again, and
   "You're all caught up" at the end.
7. **The headline link** opens the primary source (the most trusted one that covered the story) in a new tab
   with `rel="noopener noreferrer"`, so the source site can't control our tab.

---

## Step 3: The design choices

- **Colors:** taken from the blue-ink-on-white of the paper sketch. One blue for links, the active tab and
  "Official source". Dark mode follows the phone or computer setting automatically.
- **Type:** Bricolage Grotesque for headlines and controls, Literata (a serif made for screens) for the
  summary, so 80-150 words read comfortably. Fonts are bundled with the app, so they also work offline later.
- **One bold element:** the large headline. Everything else stays quiet.
- **Phones:** the card fills the screen and the three buttons sit at the bottom, within thumb reach, each at
  least 44px tall.
- **Desktop:** a centered 600px column of cards on a faint blueprint grid.
- **Accessibility:** every control is reachable by keyboard with a visible focus ring; cards are `article`
  elements named by their headline; the feed can be scrolled with arrow keys after focusing it.
- **Try it / Watch / Ask** are shown but disabled until their milestones, so the layout is already final.

---

## Step 4: Install and run the checks

```bash
npm install
npm run typecheck
npm test
```

Four test groups should pass: shared (2), API (8), web (2), worker (9).

---

## Step 5: Start everything

You need three terminals (plus Docker running):

```bash
npm run worker   # terminal 1: keeps the news flowing
npm run api      # terminal 2: http://localhost:4000/api/v1
npm run web      # terminal 3: http://localhost:5173
```

Open http://localhost:5173. You should see your real stories.

**Check on a phone-sized screen:** in Chrome press F12, click the phone icon (device toolbar) and choose a phone.
Or open the app on your actual phone: run `npm run web -- --host`, open the "Network" address Vite prints, and
add that address to `WEB_ORIGINS` in `.env` (then restart the API).

---

## Step 6: Run the end-to-end tests

These tests open a real browser, so install Chromium once:

```bash
npx playwright install chromium
```

Then:

```bash
npm run e2e -w @technews/web
```

They mock the API inside the browser, so they don't need the worker, API or databases. 16 tests should pass:
8 scenarios on a Pixel 7 screen and on a desktop screen.

| Scenario | What it proves |
|---|---|
| Card with trusted link | Headline links to the primary source, in a new tab, with `noopener` |
| Fits the screen | Nothing on the card is cut off on the right (a real bug caught during development) |
| Buttons in place | Try it, Watch and Ask are visible but disabled |
| Infinite scroll | Scrolling near the end requests the next page with the right cursor, then shows "all caught up" |
| Category switch | The right category is requested, the tab is highlighted, the URL updates |
| Shared link | Opening `?category=security` shows the Security feed |
| Empty category | Says when stories will appear |
| Server error | Shows the message and recovers with Try again |

To watch the tests run in a visible browser: `npx playwright test --headed` (from `apps/web`).
If a test fails, open the report with `npx playwright show-report` (from `apps/web`).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "The news server at http://localhost:4000/api/v1 isn't responding." | API not running | `npm run api` |
| Browser console shows a CORS error | The page's address isn't in `WEB_ORIGINS` | Add it to `.env`, restart the API |
| "No stories yet" in every category | Pipeline hasn't produced stories | `npm run summarize` |
| Port 5173 already in use | Another Vite app is running | Stop it; the port is fixed so CORS keeps working |
| The API runs on a different port | `API_PORT` changed | Start the web app with `VITE_API_URL=http://localhost:PORT/api/v1 npm run web` |
| e2e: "Executable doesn't exist" | Chromium not installed | `npx playwright install chromium` |

---

## What's next

Guide 4 adds **Try it**, starting with "Open officially": the button links to the product's own playground,
docs or download page, and only after code has checked that the link works and belongs to the official site.
