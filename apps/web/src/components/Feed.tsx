import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { StoryCard as Story } from '@technews/shared';
import { StoryCard } from './StoryCard';
import { useBookmarks } from '../bookmarks';
import { Link } from '../router';

export interface PageResult {
  data: Story[];
  meta: { nextCursor: string | null };
}

interface Props {
  queryKey: unknown[];
  fetchPage: (cursor?: string) => Promise<PageResult>;
  label: string; // e.g. "All stories", announced to screen readers
  empty: ReactNode; // what to show when there's nothing here yet
  enabled?: boolean; // false while we wait for something the query needs (e.g. sign-in)
  ready?: boolean; // false: keep showing "Loading" (e.g. until we know which stories were already read)
  hide?: (id: string) => boolean; // stories to leave out: already read on an earlier visit
  onRead?: (story: Story, watched: boolean) => void;
  onAsk: (story: Story) => void;
  onStories?: (stories: Story[]) => void; // everything shown so far: what Ask is allowed to know
}

// Same list, newer data (e.g. after Refresh): keep the old cards up while it loads, instead of "Loading stories…".
const sameList = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a.slice(0, 2)) === JSON.stringify(b.slice(0, 2));

/** Any list of story cards: a category or "For you". Snapping scroll + infinite loading. */
export function Feed({ queryKey, fetchPage, label, empty, enabled = true, ready = true, hide, onRead, onAsk, onStories }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const saveProps = useBookmarks();

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 60_000,
    enabled,
    placeholderData: (prev, prevQuery) => (prevQuery && sameList(prevQuery.queryKey, queryKey) ? keepPreviousData(prev) : undefined),
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const keyText = JSON.stringify(queryKey);

  // A different list: start from the first card.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [keyText]);

  // Load the next page when the reader gets close to the end (about two cards ahead).
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { root: scroller.current, rootMargin: '0px 0px 200% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, query.data, ready]);

  // When every card on a page was already read, the sentinel stays in view and the next page loads by itself.
  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const stories = useMemo(() => (hide ? loaded.filter((s) => !hide(s.id)) : loaded), [loaded, hide]);
  const hidden = loaded.length - stories.length;

  useEffect(() => {
    onStories?.(stories);
  }, [stories, onStories]);

  if (!ready) {
    return (
      <div className="feed" aria-label={label} aria-busy="true">
        <div className="card card-note">Loading stories…</div>
      </div>
    );
  }

  return (
    <div className="feed" ref={scroller} tabIndex={0} aria-label={label} aria-busy={query.isFetching}>
      {query.isPending && <div className="card card-note">Loading stories…</div>}

      {query.isError && stories.length === 0 && (
        <div className="card card-note" role="alert">
          <p>{query.error.message}</p>
          <p className="hint">Check that the API is running with <code>npm run api</code>, then try again.</p>
          <button type="button" className="primary" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}

      {query.isSuccess && loaded.length === 0 && <div className="card card-note">{empty}</div>}

      {stories.map((s) => (
        <StoryCard key={s.id} story={s} onAsk={onAsk} save={saveProps(s.id)} onRead={onRead && ((watched) => onRead(s, watched))} />
      ))}

      <div ref={sentinel} className="sentinel" aria-hidden="true" />

      {isFetchingNextPage && <p className="loading-more">Loading more…</p>}

      {query.isError && stories.length > 0 && (
        <div className="card card-note" role="alert">
          <p>{query.error.message}</p>
          <button type="button" className="primary" onClick={() => void fetchNextPage()}>
            Load more
          </button>
        </div>
      )}

      {query.isSuccess && loaded.length > 0 && !hasNextPage && (
        <div className="card card-note">
          <p>You're all caught up.</p>
          {hidden > 0 && (
            <p className="hint">
              {hidden === 1 ? '1 story you already read is' : `${hidden} stories you already read are`} in your <Link href="/history">History</Link>.
            </p>
          )}
          {stories.length > 0 && (
            <button type="button" className="primary" onClick={() => scroller.current?.scrollTo({ top: 0 })}>
              Back to the top
            </button>
          )}
        </div>
      )}
    </div>
  );
}
