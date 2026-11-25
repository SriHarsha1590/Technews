import { test, expect, type Page, type Route } from '@playwright/test';
import type { HistoryEntry, Me, StoryCard } from '@technews/shared';

// The API is mocked; sign-in is faked with the dev-only window.__TECHNEWS_TEST_AUTH__ hook.

const story = (n: number, tags: string[] = ['react']): StoryCard => ({
  id: n.toString(16).padStart(24, '0'),
  title: `Story number ${n}`,
  summary: 'A summary. '.repeat(10).trim(),
  tags,
  category: 'dev',
  primaryUrl: `https://example.com/${n}`,
  primarySource: { name: 'GitHub Blog', url: `https://example.com/${n}`, trustTier: 'official' },
  imageUrl: null,
  author: null,
  sourceCount: 1,
  publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
  tryLinks: [],
});
const all = [story(1), story(2, ['vite']), story(3)];

test('first visit guides a reader through topics and allows skipping', async ({ page }) => {
  await setup(page, { signedIn: true, fresh: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make TechNews yours' })).toBeVisible();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('ordinary readers cannot see administrator controls', async ({ page }) => {
  await setup(page, { signedIn: true });
  await page.goto('/admin');
  await expect(page.getByText('Administrator access required.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run news pipeline', exact: true })).toHaveCount(0);
});

test('administrators see service health and pipeline controls', async ({ page }) => {
  await setup(page, { signedIn: true });
  await page.route('**/me/capabilities', (route) => route.fulfill({ json: { data: { admin: true } } }));
  await page.route('**/me/admin', (route) => route.fulfill({ json: { data: { mongo: true, redis: true, pipeline: { state: 'idle', startedAt: null, finishedAt: null }, feedVersion: null } } }));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admin dashboard' })).toBeVisible();
  await expect(page.getByText('MongoDB', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run news pipeline', exact: true })).toBeVisible();
});

interface Backend {
  me: Me;
  saved: string[];
  history: HistoryEntry[]; // newest read first
  calls: { method: string; path: string; auth: string | null; body: unknown }[];
}

async function setup(p: Page, opts: { signedIn: boolean; fresh?: boolean; stack?: string[]; saved?: string[]; history?: HistoryEntry[] }) {
  const be: Backend = {
    me: { uid: 'test-user', stack: opts.stack ?? [], digest: { enabled: false, hour: 8, timeZone: 'UTC' } },
    saved: opts.saved ?? [],
    history: opts.history ?? [],
    calls: [],
  };
  await p.addInitScript(({ signedIn, fresh }) => {
    if (!fresh) localStorage.setItem('welcome:test-user', 'done');
    window.__TECHNEWS_TEST_AUTH__ = { user: signedIn ? { uid: 'test-user', name: 'Test Reader' } : null };
  }, { signedIn: opts.signedIn, fresh: opts.fresh ?? false });

  await p.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()!) : undefined;
    be.calls.push({ method, path, auth: req.headers()['authorization'] ?? null, body });
    const json = (data: unknown) => route.fulfill({ json: data });

    if (path === '/feed') return json({ data: all, meta: { nextCursor: null, servedFrom: 'redis' } });
    if (path === '/tags/popular') return json({ data: [{ tag: 'react', count: 5 }, { tag: 'vite', count: 3 }] });
    if (path === '/me') return json({ data: be.me });
    if (path === '/me/capabilities') return json({ data: { admin: false } });
    if (path === '/me/stack') {
      be.me.stack = body.stack;
      return json({ data: { stack: body.stack } });
    }
    if (path === '/me/feed') {
      const data = all.filter((s) => s.tags.some((t) => be.me.stack.includes(t)));
      return json({ data, meta: { nextCursor: null } });
    }
    if (path === '/me/stats') {
      return json({ data: { read: be.history.length, watched: be.history.filter((e) => e.watchedAt).length, saved: be.saved.length } });
    }
    if (path === '/me/bookmarks/ids') return json({ data: be.saved });
    if (path === '/me/bookmarks') return json({ data: all.filter((s) => be.saved.includes(s.id)), meta: { nextCursor: null } });
    const saved = path.match(/^\/me\/bookmarks\/(\w+)$/);
    if (saved) {
      be.saved = method === 'PUT' ? [saved[1], ...be.saved.filter((x) => x !== saved[1])] : be.saved.filter((x) => x !== saved[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === '/me/history/ids') return json({ data: be.history.map((e) => e.story.id) });
    if (path === '/me/history' && method === 'GET') {
      const watchedOnly = url.searchParams.get('filter') === 'watched';
      return json({ data: be.history.filter((e) => !watchedOnly || e.watchedAt), meta: { nextCursor: null } });
    }
    if (path === '/me/history' && method === 'DELETE') {
      be.history = [];
      return route.fulfill({ status: 204 });
    }
    const read = path.match(/^\/me\/history\/(\w+)$/);
    if (read) {
      const id = read[1];
      const old = be.history.find((e) => e.story.id === id);
      be.history = be.history.filter((e) => e.story.id !== id);
      if (method === 'PUT') {
        const now = new Date().toISOString();
        be.history.unshift({ story: all.find((s) => s.id === id)!, readAt: now, watchedAt: body?.watched ? now : old?.watchedAt ?? null });
      }
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'nope' } } });
  });
  return be;
}

const entry = (s: StoryCard, hoursAgo: number, watched = false): HistoryEntry => {
  const at = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { story: s, readAt: at, watchedAt: watched ? at : null };
};

async function openAccountMenu(p: Page, item: 'Profile' | 'Saved' | 'History' | 'Sign out') {
  await p.getByRole('button', { name: 'Your account' }).click();
  const menu = p.getByRole('navigation', { name: 'Your account' });
  await menu.getByRole(item === 'Sign out' ? 'button' : 'link', { name: item }).click();
}

// ---------- Signing in ----------

test('without sign-in set up, no account features appear', async ({ page: p }) => {
  await p.route('**/api/v1/feed**', (r) => r.fulfill({ json: { data: [story(1)], meta: { nextCursor: null, servedFrom: 'redis' } } }));
  await p.goto('/');
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'For you' })).toHaveCount(0);
});

test('signed out: Save opens the sign-in page, and signing in comes back to the feed', async ({ page: p }) => {
  await setup(p, { signedIn: false });
  await p.goto('/?category=dev');
  await p.getByRole('article').first().getByRole('button', { name: 'Save' }).click();

  await expect(p).toHaveURL(/\/signin\?next=%2F%3Fcategory%3Ddev$/);
  await expect(p.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(p.getByText("Stories you've already read stay out of your feed.")).toBeVisible();

  await p.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(p).toHaveURL(/\/\?category=dev$/);
  await expect(p.getByRole('button', { name: 'Your account' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'For you' })).toBeVisible();
});

test('email sign-in: a wrong password explains itself, then the right one signs in', async ({ page: p }) => {
  await setup(p, { signedIn: false });
  await p.goto('/');
  await p.getByRole('link', { name: 'Sign in' }).click();
  await expect(p).toHaveURL(/\/signin/);

  await p.getByLabel('Email').fill('ada@example.com');
  await p.getByLabel('Password', { exact: true }).fill('wrong');
  await p.getByRole('button', { name: 'Show password' }).click();
  await expect(p.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p.getByRole('alert')).toContainText("That email and password don't match");

  await p.getByLabel('Password', { exact: true }).fill('correct horse');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(p).toHaveURL(/\/$/);
  await expect(p.getByRole('button', { name: 'Your account' })).toBeVisible();
});

test('create an account and reset a password', async ({ page: p }) => {
  await setup(p, { signedIn: false });
  await p.goto('/signin');

  await p.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(p.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await p.getByLabel('Email').fill('ada@example.com');
  await p.getByRole('button', { name: 'Send reset link' }).click();
  await expect(p.getByRole('status').first()).toContainText('a link to reset the password is on its way');

  await p.getByRole('button', { name: 'Back to sign in' }).click();
  await p.getByRole('button', { name: 'Create an account' }).click();
  await expect(p.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await p.getByLabel('Your name').fill('Ada Lovelace');
  await p.getByLabel('Email').fill('ada@example.com');
  await p.getByLabel('Password', { exact: true }).fill('analytical');
  await p.getByRole('button', { name: 'Create account' }).click();

  await expect(p.getByRole('button', { name: 'Your account' })).toBeVisible();
  await openAccountMenu(p, 'Profile');
  await expect(p.locator('.profile-name')).toHaveText('Ada Lovelace');
  await expect(p.getByText('Signed in with email')).toBeVisible();
});

test('account pages ask signed-out readers to sign in, then show the page', async ({ page: p }) => {
  await setup(p, { signedIn: false, history: [entry(story(1), 1)] });
  await p.goto('/history');
  await expect(p.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(p).toHaveURL(/\/history$/);
  await expect(p.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'Story number 1' })).toBeVisible();
});

test('a shared "For you" link asks signed-out readers to sign in', async ({ page: p }) => {
  await setup(p, { signedIn: false });
  await p.goto('/?view=foryou');
  await expect(p.getByText('Sign in to get a feed for the technologies you use.')).toBeVisible();
});

test('signing out from the account menu hides the account features', async ({ page: p }) => {
  await setup(p, { signedIn: true });
  await p.goto('/');
  await openAccountMenu(p, 'Sign out');
  await expect(p.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'For you' })).toHaveCount(0);
});

// ---------- Saved ----------

test('save a story, see it on the Saved page, then remove it', async ({ page: p }) => {
  const be = await setup(p, { signedIn: true });
  await p.goto('/');
  const card = p.getByRole('article', { name: 'Story number 1' });
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true');

  const put = be.calls.find((c) => c.method === 'PUT' && c.path.startsWith('/me/bookmarks/'));
  expect(put?.auth).toBe('Bearer test-token'); // every account call carries the sign-in token

  await openAccountMenu(p, 'Saved');
  await expect(p).toHaveURL(/\/saved$/);
  const list = p.getByRole('list', { name: 'Saved stories' });
  await expect(list.getByRole('link', { name: 'Story number 1' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Story number 2' })).toHaveCount(0);

  await list.getByRole('button', { name: 'Remove: Story number 1' }).click();
  await expect(p.getByText('Nothing saved yet.')).toBeVisible();
  await expect.poll(() => be.saved).toEqual([]);
});

test('old ?view=saved links open the Saved page', async ({ page: p }) => {
  await setup(p, { signedIn: true });
  await p.goto('/?view=saved');
  await expect(p).toHaveURL(/\/saved$/);
  await expect(p.getByRole('heading', { name: 'Saved' })).toBeVisible();
});

// ---------- Reading history ----------

test('stories read on an earlier visit are hidden from the feed, unless saved', async ({ page: p }) => {
  await setup(p, { signedIn: true, history: [entry(story(1), 2), entry(story(2), 3)], saved: [story(2).id] });
  await p.goto('/');
  await expect(p.getByRole('heading', { name: 'Story number 3' })).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Story number 2' })).toBeAttached(); // read, but saved
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toHaveCount(0); // read: hidden
  await expect(p.getByText('1 story you already read is in your')).toBeAttached();
});

test('a card read for a few seconds goes into History; Watch counts as watched', async ({ page: p }) => {
  await p.clock.install();
  const be = await setup(p, { signedIn: true });
  await p.goto('/');
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toBeVisible();

  await p.clock.runFor(5000);
  await expect.poll(() => be.history.map((e) => e.story.id)).toEqual([story(1).id]);

  await p.getByRole('article', { name: 'Story number 1' }).getByRole('button', { name: 'Watch' }).click();
  await expect
    .poll(() => be.calls.some((c) => c.method === 'PUT' && c.path === `/me/history/${story(1).id}` && (c.body as { watched: boolean }).watched))
    .toBe(true);
  // Read during this visit: it stays on screen until the next one.
  await p.keyboard.press('Escape');
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toBeVisible();
});

test('History lists what was read by day, filters to watched, and removes or clears entries', async ({ page: p }) => {
  const be = await setup(p, { signedIn: true, history: [entry(story(1), 0, true), entry(story(3), 0)] });
  await p.goto('/');
  await openAccountMenu(p, 'History');
  await expect(p).toHaveURL(/\/history$/);
  await expect(p.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'Story number 1' })).toBeVisible();
  await expect(p.getByRole('link', { name: 'Story number 3' })).toBeVisible();

  await p.getByRole('link', { name: 'Watched', exact: true }).click();
  await expect(p).toHaveURL(/\/history\?filter=watched$/);
  await expect(p.getByRole('link', { name: 'Story number 3' })).toHaveCount(0);
  await p.getByRole('link', { name: 'Everything' }).click();

  await p.getByRole('button', { name: 'Remove: Story number 3' }).click();
  await expect(p.getByRole('link', { name: 'Story number 3' })).toHaveCount(0);
  await expect.poll(() => be.history.map((e) => e.story.id)).toEqual([story(1).id]);

  await p.getByRole('button', { name: 'Clear history' }).click();
  await p.getByRole('alertdialog').getByRole('button', { name: 'Clear history' }).click();
  await expect(p.getByText('Nothing here yet.')).toBeVisible();
  expect(be.history).toEqual([]);

  // Cleared: the stories show in the feed again.
  await p.getByRole('link', { name: 'Stories', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toBeVisible();
});

// ---------- Profile ----------

test('Profile shows the account, activity counts and settings', async ({ page: p }) => {
  await setup(p, { signedIn: true, saved: [story(2).id], history: [entry(story(1), 1, true), entry(story(3), 2)] });
  await p.goto('/profile');
  await expect(p.locator('.profile-name')).toHaveText('Test Reader');
  await expect(p.getByText('reader@example.com').last()).toBeVisible();
  await expect(p.getByText(/Signed in with Google · Member since/)).toBeVisible();

  const stats = p.getByRole('navigation', { name: 'Your activity' });
  await expect(stats.getByRole('link', { name: '2 Read' })).toBeVisible();
  await expect(stats.getByRole('link', { name: '1 Watched' })).toBeVisible();
  await expect(stats.getByRole('link', { name: '1 Saved' })).toBeVisible();
  await stats.getByRole('link', { name: '1 Saved' }).click();
  await expect(p).toHaveURL(/\/saved$/);
});

test('"For you": pick a stack on the Profile page, then see only stories in it', async ({ page: p }) => {
  const be = await setup(p, { signedIn: true });
  await p.goto('/?view=foryou');
  await expect(p.getByText('Pick the technologies you use')).toBeVisible();

  await p.getByRole('link', { name: 'Choose your stack' }).click();
  await expect(p).toHaveURL(/\/profile#stack$/);
  const section = p.getByRole('region', { name: 'My stack' });
  await section.getByRole('button', { name: 'vite' }).click();
  await section.getByLabel('Add a technology').fill('Rust');
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(section.getByRole('button', { name: 'rust' })).toHaveAttribute('aria-pressed', 'true');
  await section.getByRole('button', { name: 'Save my stack' }).click();
  await expect(section.getByRole('status')).toContainText('Saved');
  expect(be.calls.find((c) => c.path === '/me/stack')?.body).toEqual({ stack: ['vite', 'rust'] });

  await p.goBack();
  await expect(p.getByRole('heading', { name: 'Story number 2' })).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Story number 1' })).toHaveCount(0);
});
