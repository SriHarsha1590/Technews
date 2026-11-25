import { AdminPage, WelcomePage, StoryPage } from './components/ReaderPages';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { FEED_NAMES, type FeedName, type StoryCard } from '@technews/shared';
import { useAuth } from './auth';
import { fetchCapabilities, fetchFeed, fetchForYou, fetchMe } from './api';
import { CATEGORY_LABEL } from './format';
import { useFreshOnReturn, useReadTracking } from './history';
import { Link, navigate, signInHref, useLocation } from './router';
import { ViewTabs, type Tab } from './components/ViewTabs';
import { Feed, type PageResult } from './components/Feed';
import { AskPanel } from './components/AskPanel';
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
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { user, token } = auth;
  const { page, params, href } = useLocation();
  const view = readView(params);
  const activeView = useRef(view);
  activeView.current = view;
  const [stories, setStories] = useState<StoryCard[]>([]); // the cards shown in the current view: Ask's context
  const [askOpen, setAskOpen] = useState(false);
  const [focus, setFocus] = useState<StoryCard | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // reload the latest cards already published by the pipeline
  const refreshVersion = useRef(0);
  const [refreshingStories, setRefreshingStories] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const refreshing = useRef(false);
  const refreshed = useCallback(() => {
    refreshVersion.current += 1;
    setRefreshKey(refreshVersion.current);
  }, []);
  const reads = useReadTracking();
  useFreshOnReturn(refreshed);
  useEffect(() => {
    if (!refreshMessage) return;
    const timer = setTimeout(() => setRefreshMessage(''), 6000);
    return () => clearTimeout(timer);
  }, [refreshMessage]);

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
  const capabilities = useQuery({ queryKey: ['capabilities', user?.uid], queryFn: async () => fetchCapabilities(await token()), enabled: Boolean(user) });
  useEffect(() => {
    if (page === 'story') return; // StoryPage uses the fetched headline once available.
    const title = page === 'feed' ? (view === 'foryou' ? 'For you' : `${CATEGORY_LABEL[view]} stories`)
      : page === 'saved' ? 'Saved stories'
      : page === 'history' ? 'Reading history'
      : page === 'profile' ? 'Profile'
      : page === 'signin' ? 'Sign in'
      : page === 'admin' ? 'Admin dashboard'
      : 'Welcome';
    document.title = `${title} · TechNews`;
  }, [page, view]);
  const refreshStories = async () => {
    if (refreshing.current || (view === 'foryou' && !user)) return;
    refreshing.current = true;
    setRefreshingStories(true);
    setRefreshMessage('');
    const currentKey = view === 'foryou' ? ['foryou', user!.uid, stack, refreshKey] : ['feed', view, refreshKey];
    const previous = queryClient.getQueryData<InfiniteData<PageResult>>(currentKey)?.pages[0]?.data.map((story) => story.id);
    try {
      const latest = view === 'foryou' ? await fetchForYou(await token()) : await fetchFeed(view, undefined, true);
      if (activeView.current !== view) return; // the reader switched tabs while this request was in flight
      const nextKey = refreshVersion.current + 1;
      const nextQueryKey = view === 'foryou' ? ['foryou', user!.uid, stack, nextKey] : ['feed', view, nextKey];
      queryClient.setQueryData<InfiniteData<PageResult>>(nextQueryKey, { pages: [latest], pageParams: [undefined] });
      refreshed();
      const current = latest.data.map((story) => story.id);
      setRefreshMessage(previous && previous.length === current.length && previous.every((id, i) => id === current[i])
        ? "You're up to date."
        : 'Latest stories loaded.');
    } catch {
      setRefreshMessage('Could not check for new stories. Try again.');
    } finally {
      refreshing.current = false;
      setRefreshingStories(false);
    }
  };
  useEffect(() => {
    if (user && me.isSuccess && !stack.length && page === 'feed' && !localStorage.getItem(`welcome:${user.uid}`)) navigate('/welcome');
  }, [user, me.isSuccess, stack.length, page]);

  const change = (id: string) => {
    setFocus(null);
    setRefreshMessage('');
    navigate(viewHref(id as View), { replace: true });
  };

  const tabs: Tab[] = [
    ...(user ? [{ id: 'foryou', label: 'For you' }] : []),
    ...FEED_NAMES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
  ];

  let content: ReactNode;
  if (page === 'story') {
    content = <StoryPage id={params.get('id') ?? ''} />;
  } else if (page === 'signin') {
    content = <div className="scroll"><SignInPage next={params.get('next')} /></div>;
  } else if (page !== 'feed') {
    // Saved, History and Profile belong to an account: signed-out readers get the sign-in page right here.
    let inner: ReactNode;
    if (!auth.ready) inner = <p className="page hint">Loading…</p>;
    else if (!user) inner = <SignInPage next={href} />;
    else if (page === 'saved') inner = <SavedPage user={user} />;
    else if (page === 'history') inner = <HistoryPage user={user} filter={params.get('filter') === 'watched' ? 'watched' : 'all'} />;
    else if (page === 'welcome') inner = <WelcomePage />;
    else if (page === 'admin') inner = capabilities.data?.admin ? <AdminPage /> : <p className="page">Administrator access required.</p>;
    else inner = <ProfilePage key={user.uid} user={user} />;
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
            <p className="hint">The news pipeline checks sources every 5 minutes. Press Refresh stories to check for newly published cards.</p>
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
                <div className="reader-refresh">
                  <button type="button" className="ask-top" onClick={() => void refreshStories()} disabled={refreshingStories} aria-label="Refresh stories" title="Check for stories already published by the news pipeline">
                    <Icon name="replay" />
                    Refresh stories
                  </button>
                  <span className="reader-refresh-note" role="status">{refreshingStories ? 'Checking stories…' : refreshMessage}</span>
                </div>
                <button type="button" className="ask-top" aria-haspopup="dialog" onClick={() => openAsk()}>
                  <Icon name="ask" />
                  Ask the feed
                </button>
              </>
            )}
            {auth.enabled && auth.ready && (user ? (
              <AccountMenu user={user} admin={capabilities.data?.admin ?? false} />
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
