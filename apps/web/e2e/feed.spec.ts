import { test, expect, type Page, type Route } from '@playwright/test';
import type { FeedResponse, StoryCard } from '@technews/shared';

// Every test mocks the API, so these run without MongoDB, Redis, Temporal or the worker.

const story = (n: number, over: Partial<StoryCard> = {}): StoryCard => ({
  id: n.toString(16).padStart(24, '0'),
  title: `Story number ${n} ships something new`,
  summary: `Summary for story ${n}. `.repeat(6).trim(),
  tags: ['react', 'tooling'],
  category: 'dev',
  primaryUrl: `https://example.com/story-${n}`,
  primarySource: { name: 'GitHub Blog', url: `https://example.com/story-${n}`, trustTier: 'official' },
  imageUrl: null,
  author: 'Jane Doe',
  sourceCount: 3,
  publishedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  tryLinks: [],
  ...over,
});

const page = (data: StoryCard[], nextCursor: string | null = null): FeedResponse => ({
  data,
  meta: { nextCursor, servedFrom: 'redis' },
});

async function mockFeed(p: Page, handler: (url: URL) => FeedResponse | { status: number }) {
  await p.route('**/api/v1/feed**', async (route: Route) => {
    const result = handler(new URL(route.request().url()));
    if ('status' in result) {
      await route.fulfill({ status: result.status, json: { error: { code: 'internal_error', message: 'Something went wrong' } } });
    } else {
      await route.fulfill({ json: result });
    }
  });
}

test('shows a story card with a headline that opens the trusted source', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1)]));
  await p.goto('/');

  const card = p.getByRole('article', { name: 'Story number 1 ships something new' });
  await expect(card).toBeVisible();
  const link = card.getByRole('link', { name: 'Story number 1 ships something new' });
  await expect(link).toHaveAttribute('href', 'https://example.com/story-1');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(card.getByText('Official source')).toBeVisible();
  await expect(card.getByText('Covered by 3 sources')).toBeVisible();
  await expect(card.getByText('2h ago')).toBeVisible();
});

test('the card shows the author and the article image, and no tags', async ({ page: p }) => {
  await p.route('https://images.example.com/**', (route) => route.fulfill({ status: 404 }));
  await mockFeed(p, () => page([story(1, { imageUrl: 'https://images.example.com/hero.jpg' }), story(2, { author: null })]));
  await p.goto('/');

  const first = p.getByRole('article', { name: 'Story number 1 ships something new' });
  await expect(first.getByText('By Jane Doe')).toBeVisible();
  await expect(first.locator('.card-image')).toBeVisible();
  await expect(first.getByText('react')).toHaveCount(0); // tags are no longer shown
  const second = p.getByRole('article', { name: 'Story number 2 ships something new' });
  await expect(second.getByText('By GitHub Blog')).toBeAttached(); // no byline in the feed: the publication
});

test('the card fits the screen with nothing cut off on the right', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1)]));
  await p.goto('/');
  const card = p.getByRole('article').first();
  await expect(card).toBeVisible();
  const viewport = p.viewportSize()!;
  for (const el of [card, card.getByText('2h ago'), card.getByRole('button', { name: 'Ask' })]) {
    const box = (await el.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
});

test('long phone cards keep the main actions in view', async ({ page: p }) => {
  test.skip((p.viewportSize()?.width ?? 0) > 520, 'Phone layout only');
  await p.setViewportSize({ width: 393, height: 650 });
  await p.route('https://images.example.com/**', (route) => route.fulfill({ status: 404 }));
  await mockFeed(p, () => page([story(1, {
    imageUrl: 'https://images.example.com/hero.jpg',
    summary: 'This story explains a software release and how developers can use it. '.repeat(18),
  })]));
  await p.goto('/');
  const card = p.getByRole('article').first();
  await expect(card).toBeVisible();
  const viewport = p.viewportSize()!;
  for (const name of ['Try it', 'Watch', 'Ask']) {
    const box = (await card.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
});

test('signed-out header fits phone and desktop without clipping or wrapping', async ({ page: p }) => {
  const mobile = (p.viewportSize()?.width ?? 0) <= 520;
  await p.setViewportSize(mobile ? { width: 320, height: 640 } : { width: 1440, height: 900 });
  await p.addInitScript(() => { window.__TECHNEWS_TEST_AUTH__ = { user: null }; });
  await mockFeed(p, () => page([story(1)]));
  await p.goto('/');
  const viewport = p.viewportSize()!;
  for (const control of [p.getByRole('button', { name: 'Refresh stories' }), p.getByRole('button', { name: 'Ask the feed' }), p.getByRole('link', { name: 'Sign in' })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  }
  const signIn = (await p.getByRole('link', { name: 'Sign in' }).boundingBox())!;
  expect(signIn.height).toBeLessThanOrEqual(42);
  expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
});

test('Try it works on every card: AI steps without links, then the source article', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1)]));
  await p.route('**/api/v1/stories/*/try-guide', (route) =>
    route.fulfill({ json: { data: { storyId: story(1).id, steps: ['Install the CLI from the official docs.', 'Run the first example.'] } } }),
  );
  await p.goto('/');
  const card = p.getByRole('article').first();
  for (const name of ['Try it', 'Watch', 'Ask']) await expect(card.getByRole('button', { name, exact: true })).toBeEnabled();

  await card.getByRole('button', { name: 'Try it' }).click();
  const sheet = p.getByRole('dialog', { name: 'Try it' });
  await expect(sheet.getByRole('listitem')).toHaveText(['Install the CLI from the official docs.', 'Run the first example.']);
  await expect(sheet.getByLabel('Verified links')).toHaveCount(0);
  const links = sheet.getByRole('link');
  await expect(links).toHaveCount(1); // only the source: AI steps never become links
  await expect(links).toHaveAttribute('href', 'https://example.com/story-1');
  await expect(links).toContainText('Read on GitHub Blog');
});

test('Watch plays a short narrated explainer with captions and closes with Escape', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1)]));
  const narration = 'word '.repeat(20).trim();
  await p.route('**/api/v1/stories/*/explainer', (route) =>
    route.fulfill({
      json: {
        data: {
          storyId: story(1).id, imageUrl: null, seconds: 33,
          scenes: [{ caption: 'What happened', narration }, { caption: 'Why it matters', narration }, { caption: 'What next', narration }],
        },
      },
    }),
  );
  await p.goto('/');
  await p.getByRole('button', { name: 'Watch' }).click();

  const sheet = p.getByRole('dialog', { name: 'Watch' });
  await expect(sheet.getByRole('heading', { name: 'What happened' })).toBeVisible();
  await expect(sheet.getByText(/0:\d\d \/ 0:2\d/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Next scene' }).click();
  await expect(sheet.getByRole('heading', { name: 'Why it matters' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Pause' }).click();
  await expect(sheet.getByRole('button', { name: 'Play' })).toBeVisible();

  await p.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('Ask sends only the cards on screen and shows which ones the answer used', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1), story(2, { title: 'A security patch for routers' })]));
  let sent: any;
  await p.route('**/api/v1/ask', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { data: { answer: 'Patch your routers.\n- Update today', storyIds: [story(2).id] } } });
  });
  await p.goto('/');
  await p.getByRole('article', { name: 'A security patch for routers' }).getByRole('button', { name: 'Ask', exact: true }).click();

  const panel = p.getByRole('dialog', { name: 'Ask' });
  await expect(panel.getByText("Answers come from this week's news")).toBeVisible();
  await expect(panel.getByText('A security patch for routers')).toBeVisible(); // focus chip
  await panel.getByLabel('Your question').fill('Do I need to patch anything?');
  await panel.getByLabel('Your question').press('Enter');

  await expect(panel.getByText('Patch your routers.')).toBeVisible();
  await expect(panel.getByText('Update today')).toBeVisible(); // a lone "- " line renders as a sentence, not a list
  expect(sent.storyIds).toEqual([story(1).id, story(2).id]);
  expect(sent.focusId).toBe(story(2).id);
  expect(sent.question).toBe('Do I need to patch anything?');

  await panel.getByRole('button', { name: 'A security patch for routers' }).click(); // cited story
  await expect(panel).toBeHidden();
});

test('Try it opens the verified links, most direct first, and closes with Escape', async ({ page: p }) => {
  const checkedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
  await mockFeed(p, () =>
    page([
      story(1, {
        title: 'OpenAI releases Astra 6',
        tryLinks: [
          { type: 'docs', url: 'https://platform.openai.com/docs/astra', domain: 'platform.openai.com', checkedAt },
          { type: 'playground', url: 'https://platform.openai.com/playground', domain: 'platform.openai.com', checkedAt },
        ],
      }),
    ]),
  );
  await p.route('**/api/v1/stories/*/try-guide', (route) => route.fulfill({ json: { data: { storyId: story(1).id, steps: [] } } }));
  await p.goto('/');
  await p.getByRole('button', { name: 'Try it' }).click();

  const sheet = p.getByRole('dialog', { name: 'Try it' });
  await expect(sheet).toBeVisible();
  const links = sheet.getByLabel('Verified links').getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toContainText('Try it online');
  await expect(links.nth(0)).toHaveAttribute('href', 'https://platform.openai.com/playground');
  await expect(links.nth(0)).toHaveAttribute('rel', /noopener/);
  await expect(links.nth(1)).toContainText('Read the docs');
  await expect(sheet.getByText('Opens platform.openai.com').first()).toBeVisible();
  await expect(sheet.getByText('Link checked 3h ago').first()).toBeVisible();

  await p.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await p.getByRole('button', { name: 'Try it' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
});

test('loads the next page when scrolling near the end, then says all caught up', async ({ page: p }) => {
  const cursors: (string | null)[] = [];
  await mockFeed(p, (url) => {
    const cursor = url.searchParams.get('cursor');
    cursors.push(cursor);
    return cursor === 'page2' ? page([story(3), story(4)]) : page([story(1), story(2)], 'page2');
  });
  await p.goto('/');
  await expect(p.getByRole('heading', { name: /Story number 1/ })).toBeVisible();

  await p.getByLabel('All stories').evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(p.getByRole('heading', { name: /Story number 4/ })).toBeAttached();
  await expect(p.getByText("You're all caught up.")).toBeAttached();
  expect(cursors).toEqual([null, 'page2']);
});

test('switching category asks the API for that category and updates the URL', async ({ page: p }) => {
  await mockFeed(p, (url) =>
    url.searchParams.get('category') === 'ai'
      ? page([story(7, { title: 'A new open model for coding', category: 'ai' })])
      : page([story(1)]),
  );
  await p.goto('/');
  await p.getByRole('button', { name: 'AI', exact: true }).click();

  await expect(p.getByRole('heading', { name: 'A new open model for coding' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(p).toHaveURL(/\?category=ai$/);
});

test('reader refresh loads published stories without starting the pipeline', async ({ page: p }) => {
  let newerPublished = false;
  let pipelineCalls = 0;
  await mockFeed(p, () => page(newerPublished ? [story(2), story(1)] : [story(1)]));
  await p.route('**/api/v1/refresh', (route) => {
    pipelineCalls++;
    return route.fulfill({ status: 500 });
  });
  await p.goto('/');
  await expect(p.getByRole('heading', { name: /Story number 1/ })).toBeVisible();

  newerPublished = true;
  await p.getByRole('button', { name: 'Refresh stories' }).click();
  await expect(p.getByRole('heading', { name: /Story number 2/ })).toBeVisible();
  await expect(p.getByText('Latest stories loaded.')).toBeVisible();

  await p.getByRole('button', { name: 'Refresh stories' }).click();
  await expect(p.getByText("You're up to date.")).toBeVisible();
  expect(pipelineCalls).toBe(0);
});

test('opening a shared link restores the category', async ({ page: p }) => {
  await mockFeed(p, (url) => page([story(1, { title: `Feed was ${url.searchParams.get('category')}` })]));
  await p.goto('/?category=security');
  await expect(p.getByRole('heading', { name: 'Feed was security' })).toBeVisible();
});

test('browser title follows the current feed view', async ({ page: p }) => {
  await mockFeed(p, () => page([story(1)]));
  await p.goto('/?category=ai');
  await expect(p).toHaveTitle('AI stories · TechNews');
  await p.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect(p).toHaveTitle('Tools stories · TechNews');
});

test('a shared story uses its headline as the browser title', async ({ page: p }) => {
  await p.route('**/api/v1/stories/*', (route) => route.fulfill({ json: { data: story(1) } }));
  await p.goto(`/story?id=${story(1).id}`);
  await expect(p).toHaveTitle('Story number 1 ships something new · TechNews');
});

test('empty category explains when stories will appear', async ({ page: p }) => {
  await mockFeed(p, () => page([]));
  await p.goto('/?category=research');
  await expect(p.getByText('No Research stories yet.')).toBeVisible();
  await expect(p.getByText('The news pipeline checks sources every 5 minutes.')).toBeVisible();
});

test('server error shows what happened and recovers with Try again', async ({ page: p }) => {
  let calls = 0;
  await mockFeed(p, () => (++calls <= 2 ? { status: 500 } : page([story(1)]))); // the app retries once by itself
  await p.goto('/');

  await expect(p.getByRole('alert')).toContainText('We could not load stories right now.');
  await p.getByRole('button', { name: 'Try again' }).click();
  await expect(p.getByRole('heading', { name: /Story number 1/ })).toBeVisible();
});
