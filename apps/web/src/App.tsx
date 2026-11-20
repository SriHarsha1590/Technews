import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FEED_NAMES, type FeedName, type StoryCard } from '@technews/shared';
import { useAuth } from './auth';
import { fetchFeed, fetchForYou, fetchMe } from './api';
import { CATEGORY_LABEL } from './format';
import { useFreshOnReturn, useReadTracking } from './history';
import { Link, navigate, signInHref, useLocation } from './router';
import { ViewTabs, type Tab } from './components/ViewTabs';
import { Feed } from './components/Feed';
import { AskPanel } from './components/AskPanel';
import { RefreshButton } from './components/RefreshButton';
import { AccountMenu } from './components/AccountMenu';
import { SignInPage } from './components/SignInPage';
import { SavedPage } from './components/SavedPage';
import { HistoryPage } from './components/HistoryPage';
import { ProfilePage } from './components/ProfilePage';
import { Icon } from './components/Icon';

type View = FeedName | 'foryou';
const isCategory = (v: string): v is FeedName => (FEED_NAMES as readonly string[]).includes(v);

// The feed's view lives in the URL (?category=ai, ?view=foryou) so it can be bookmarked or shared.
function readView(q: URLSearchParams): View {
  if (q.get('view') === 'foryou') return 'foryou';
  const c = q.get('category') ?? '';
  return isCategory(c) ? c : 'all';
}

function viewHref(view: View): string {
  if (view === 'foryou') return '/?view=foryou';
  return view === 'all' ? '/' : `/?category=${view}`;
}

export function App() {
  const auth = useAuth();
  const { user, token } = auth;
  const { page, params, href } = useLocation();
  const view = readView(params);
  const [stories, setStories] = useState<StoryCard[]>([]); // the cards shown in the current view: Ask's context
  const [askOpen, setAskOpen] = useState(false);
  const [focus, setFocus] = useState<StoryCard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // bumped each time a Refresh run publishes new cards
  const refreshed = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reads = useReadTracking();
  useFreshOnReturn(refreshed);

  // Old links to the Saved tab (?view=saved) open the Saved page.
  useEffect(() => {
    if (page === 'feed' && params.get('view') === 'saved') navigate('/saved', { replace: true });
  }, [page, params]);

  const openAsk = useCallback((story?: StoryCard) => {
    setFocus(story ?? null);
    setAskOpen(true);
  }, []);

  const showStory = (id: string) => {
    setAskOpen(false);
    document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start' });
  };
  const listProps = {
    onAsk: openAsk,
    onStories: setStories,
    hide: reads.hide,
    ready: reads.ready,
    onRead: reads.markRead,
  };

  const me = useQuery({ queryKey: ['me', user?.uid], queryFn: async () => fetchMe(await token()), enabled: Boolean(user) });
  const stack = me.data?.stack ?? [];

  const change = (id: string) => {
    setFocus(null);
    navigate(viewHref(id as View), { replace: true });
  };

  const tabs: Tab[] = [
    ...(user ? [{ id: 'foryou', label: 'For you' }] : []),
    ...FEED_NAMES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
  ];

  let content: ReactNode;
  if (page === 'signin') {
    content = <div className="scroll"><SignInPage next={params.get('next')} /></div>;
  } else if (page !== 'feed') {
    // Saved, History and Profile belong to an account: signed-out readers get the sign-in page right here.
    let inner: ReactNode;
    if (!auth.ready) inner = <p className="page hint">Loading…</p>;
    else if (!user) inner = <SignInPage next={href} />;
    else if (page === 'saved') inner = <SavedPage user={user} />;
    else if (page === 'history') inner = <HistoryPage user={user} filter={params.get('filter') === 'watched' ? 'watched' : 'all'} />;
    else inner = <ProfilePage user={user} />;
    content = <div className="scroll">{inner}</div>;
  } else if (isCategory(view)) {
    const name = view === 'all' ? '' : `${CATEGORY_LABEL[view]} `;
    content = (
      <Feed
        queryKey={['feed', view, refreshKey]}
        // After a refresh the browser's cached first page is out of date, so ask the server again.
        fetchPage={(cursor) => fetchFeed(view, cursor, refreshKey > 0 && !cursor)}
        label={`${CATEGORY_LABEL[view]} stories`}
        empty={
          <>
            <p>No {name}stories yet.</p>
            <p className="hint">New stories are added every 5 minutes. Reload the page to see them, or press Refresh to fetch them now.</p>
          </>
        }
        {...listProps}
      />
    );
  } else if (!auth.ready) {
    content = <div className="feed"><div className="card card-note">Loading…</div></div>;
  } else if (!user) {
    content = (
      <div className="feed">
        <div className="card card-note">
          <p>Sign in to get a feed for the technologies you use.</p>
          <Link className="primary" href={signInHref()}>Sign in</Link>
        </div>
      </div>
    );
  } else {
    content = (
      <Feed
        queryKey={['foryou', user.uid, stack, refreshKey]}
        fetchPage={async (cursor) => fetchForYou(await token(), cursor)}
        label="For you stories"
        enabled={me.isSuccess}
        {...listProps}
        empty={
          <>
            <p>{stack.length === 0 ? "Pick the technologies you use, and this tab shows what's new in them." : 'Nothing new in your stack in the last 30 days.'}</p>
            <Link className="primary" href="/profile#stack">{stack.length === 0 ? 'Choose your stack' : 'Edit your stack'}</Link>
          </>
        }
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <h1 className="brand">
            <Link href="/" className="brand-link">
              <span className="brand-mark" aria-hidden="true">T</span>
              TechNews
            </Link>
          </h1>
          <div className="topbar-actions">
            {page === 'feed' && (
              <>
                <RefreshButton onUpdate={refreshed} />
                <button type="button" className="ask-top" aria-haspopup="dialog" onClick={() => openAsk()}>
                  <Icon name="ask" />
                  Ask the feed
                </button>
              </>
            )}
            {auth.enabled && auth.ready && (user ? (
              <AccountMenu user={user} />
            ) : (
              page !== 'signin' && <Link className="signin" href={signInHref()}>Sign in</Link>
            ))}
          </div>
        </div>
        {page === 'feed' && <ViewTabs tabs={tabs} value={view} onChange={change} />}
      </header>
      <main className="main">{content}</main>
      <AskPanel
        open={askOpen}
        onClose={() => setAskOpen(false)}
        stories={stories}
        focus={focus}
        onClearFocus={() => setFocus(null)}
        onShowStory={showStory}
      />
    </div>
  );
}
