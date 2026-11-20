# Guide 5: Accounts, Saved, My stack and the daily digest

Readers can now sign in with Google and get four things:

| Feature | What the reader sees |
|---|---|
| **Sign in** | A "Sign in" link top right opens the **sign-in page** (`/signin`): Google, or email and password (with "Forgot password?" and "Create an account"). Once signed in, their photo or initial opens the **account menu**: Profile, Saved, History, Sign out |
| **Profile** | `/profile`: name, email, member since, counts of stories read / watched / saved, My stack, daily digest, sign out |
| **Saved** | A bookmark on every card; saved stories are on the **Saved page** (`/saved`), on any device |
| **History** | `/history`: every story the reader read or watched, grouped by day, filter "Watched", remove one or clear all. Private to each account |
| **Only what's new** | Stories read on an **earlier visit** are hidden from the feed (unless saved), so new stories come first. A card counts as read after filling the screen for 4 seconds, or when its headline, Try it, Watch or Ask is used. Stories read during this visit stay on screen until the next one, so nothing vanishes mid-scroll. Removing a story from History brings it back |
| **For you** | Pick technologies under **My stack**; the **For you** tab shows everything in them from the last 30 days, newest first |
| **Daily digest** | One notification a day, at the hour they choose, with the top 3 new stories in their stack |

Everything is optional. Until sign-in is set up, the app hides every account feature and works exactly as before.

---

## Step 1: Understand what was added

**Web app (`apps/web`)**

| File | What it does |
|---|---|
| `src/auth.tsx` | Sign-in state. Loads Firebase only if it's configured, as a separate download |
| `src/bookmarks.ts` | Which stories are saved; the bookmark flips instantly and rolls back if the server refuses |
| `src/components/SettingsSheet.tsx` | My stack, the daily digest, sign out |
| `src/components/ViewTabs.tsx` | Tabs: **For you** (signed in), the categories, **Saved** (signed in) |
| `src/components/Feed.tsx` | Now shows any list of cards: a category, For you or Saved |
| `src/push.ts`, `public/sw.js` | Turn notifications on/off; the service worker shows them and opens the app when tapped |

**API (`apps/api`)**

| Endpoint | What it does |
|---|---|
| `GET /me` | Your stack and digest settings |
| `PUT /me/stack` | Save your stack (cleaned: trimmed, lowercase, no duplicates, max 20) |
| `GET /me/feed` | "For you": stories tagged with your stack, last 30 days |
| `GET /me/bookmarks`, `GET /me/bookmarks/ids` | Saved stories (newest first) and just their ids |
| `PUT` / `DELETE /me/bookmarks/:id` | Save / unsave (saving twice is harmless) |
| `PUT /me/digest` | Digest on/off, hour, and your time zone |
| `GET /me/stats` | Counts for the Profile page: read, watched, saved |
| `GET /me/history?filter=all\|watched` | History, newest first (keeps a copy of each card, so it outlives the 7-day story retention) |
| `GET /me/history/ids` | Ids read in the last 8 days: what the feed hides |
| `PUT /me/history/:id` | Record a read (`{"watched": true}` for Watch); reading again moves it to the top |
| `DELETE /me/history/:id`, `DELETE /me/history` | Remove one entry / clear all |
| `POST` / `DELETE /me/push` | Register / remove this browser for notifications |
| `GET /tags/popular` | Topics for the My stack picker (public) |
| `GET /push/public-key` | The public key browsers need to subscribe (public) |

Every `/me` route needs `Authorization: Bearer <Firebase ID token>`. The API checks the token's signature
against Google's published keys, plus its project, issuer and expiry (`src/auth.ts`), using the `jose` library.
No Firebase service account or secret file is needed on the server. `/me` responses are `private, no-store`,
so Cloudflare never caches one reader's data for another.

**Worker (`apps/worker`)**: `digestWorkflow` runs every hour. For each reader with the digest on, it checks
whether it's their chosen hour in **their own time zone** (with a 3-hour catch-up window if the worker was down),
picks the top 3 stories from the last 24 hours in their stack, and sends one notification to each of their
devices. A reader never gets two in one day, and readers with nothing new get nothing.

**Data stored per reader:** their Firebase id, stack, digest settings, saved story ids, reading history
(`history` collection: story copy, first/last read time, last watched time) and push subscriptions.
No name or email is stored on our server; the Profile page reads them from Firebase in the browser.

---

## Step 2: Create a Firebase project (about 5 minutes, free)

1. Open https://console.firebase.google.com and click **Create a project**. Name it (e.g. `technews`).
   Google Analytics isn't needed.
2. In the left menu: **Build → Authentication → Get started**.
3. Open the **Sign-in method** tab, click **Google**, switch it on, pick a support email, **Save**.
   Then **Add new provider → Email/Password**, switch on the first toggle (not "Email link"), **Save**.
   Without this, the email form on the sign-in page says email sign-in isn't turned on.
4. **Authentication → Settings → Authorized domains**: `localhost` is already there. Add your real domain
   when you put the app online.
5. Click the gear icon → **Project settings → General**. Under **Your apps**, click the web icon `</>`,
   name it `technews-web` and register it (no Firebase Hosting). It shows a `firebaseConfig` block.

---

## Step 3: Put the values in `.env`

Copy from the `firebaseConfig` block:

```
FIREBASE_PROJECT_ID=technews-xxxxx          # projectId (the API checks tokens belong to this project)
VITE_FIREBASE_API_KEY=AIza...                # apiKey
VITE_FIREBASE_AUTH_DOMAIN=technews-xxxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=technews-xxxxx
VITE_FIREBASE_APP_ID=1:1234:web:abcd
```

- **Why `VITE_`:** only settings starting with `VITE_` are sent to the browser. The web app now reads them from the
  project's root `.env`.
- **Is the API key secret?** No. Firebase's web `apiKey` only identifies your project; it's meant to be in the
  browser. Security comes from the authorized domains and the server-side token check.
- **`VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`** were generated by the update script. The private key **is**
  secret: never commit `.env` (it's already in `.gitignore`).
- Set **`VAPID_SUBJECT`** to `mailto:` plus your email. Push services use it to contact you if something goes wrong.

Restart everything after editing `.env` (worker, API and web app all read it at startup).

---

## Step 4: Run the checks

```bash
npm run typecheck
npm test
npm run e2e -w @technews/web
```

Expected:
- **Unit tests:** shared 2, API 28, web 6, worker 28.
- **Browser tests:** 52 (26 scenarios on a phone and a desktop screen).

New tests cover:
- **Token checks** with real signed tokens: wrong project, wrong issuer, expired and forged tokens are all rejected.
- **Every `/me` route** refuses requests without a valid token, and one reader can't see another's bookmarks.
- **Input rules:** stack cleaning, digest hour and time zone, https-only push endpoints, broken JSON.
- **Digest timing** across time zones, once per day, catch-up window, and the message text.
- **In the browser:** account features hidden when sign-in isn't set up, Save asking signed-out readers to sign in,
  saving and un-saving, the Saved tab, choosing a stack and seeing For you change, sign-out.

---

## Step 5: Try it yourself

1. Start everything (`npm run dev`, or the worker, API and web app in three terminals).
2. Open http://localhost:5173 and click **Sign in**. A Google window opens.
3. **Save** a story with the bookmark icon, then open the **Saved** tab.
4. Click your initial (top right) → **My stack** → pick a few topics or add your own → **Save my stack**.
   Open **For you**.
5. Under **Daily digest**, tick **Send me a daily digest**. The browser asks to allow notifications: allow it.
   Pick the hour.
6. Add the hourly schedule (once):
   ```bash
   npm run schedules
   ```
7. **Test the notification now** instead of waiting: set the digest time to the current hour, then run
   `npm run digest`. You should get a notification. Tapping it opens **For you**. The command prints
   `{ "due": 1, "sent": 1, ... }`. Run it again and `due` is 0: one digest per day.

---

## Limits to know about

| Limit | Why | When it's solved |
|---|---|---|
| Notifications need **https** (or `localhost`) | Browsers only allow push on secure sites | When the app is online with https (beta step) |
| **iPhone** shows notifications only for apps added to the home screen | Apple's rule for web apps | The beta step adds "Add to home screen" (PWA) |
| Opening the app from your phone on `http://192.168.x.x` can't sign in or get notifications | Not a secure address, and not an authorized domain | Same: once it's online with https |
| For you matches **exact tags** (`react` doesn't match `react native`) | Tags come from the summarizer | Pick from the suggested topics; they're the tags actually in use |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No "Sign in" button | `VITE_FIREBASE_*` missing, or web app not restarted | Fill all four in `.env`, restart `npm run web` |
| Google window says "unauthorized domain" | The address isn't in Authorized domains | Add it in Firebase (Step 2.4) |
| Saving fails: "Sign-in is not set up on this server" | `FIREBASE_PROJECT_ID` empty | Set it in `.env`, restart the API |
| Saving fails: "Your sign-in has expired or is invalid" | `FIREBASE_PROJECT_ID` doesn't match the web app's project | Use the same project id in both |
| Digest: "Notifications are blocked for this site" | You clicked Block earlier | Click the lock icon in the address bar → Notifications → Allow |
| Digest: "Notifications are not set up on this server" | `VAPID_PUBLIC_KEY` empty | Generate keys with `npx web-push generate-vapid-keys`, set `VAPID_*` in `.env`, restart |
| `npm run digest` shows `due: 0` | Not your chosen hour yet, or already sent today | Set the time to the current hour; it's one digest per day |
| `noDevice: 1` | Digest is on but this browser isn't subscribed | Untick and tick **Send me a daily digest** again |
