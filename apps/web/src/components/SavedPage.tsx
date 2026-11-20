import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth, type AuthUser } from '../auth';
import { fetchSaved } from '../api';
import { useBookmarks, useSavedIds } from '../bookmarks';
import { useReadTracking } from '../history';
import { Link } from '../router';
import { PageHeader, StoryRow } from './StoryRow';

/** Every story the reader saved, newest first. */
export function SavedPage({ user }: { user: AuthUser }) {
  const { token } = useAuth();
  const saveProps = useBookmarks();
  const savedIds = useSavedIds();
  const { markRead } = useReadTracking();

  const q = useInfiniteQuery({
    queryKey: ['saved', user.uid],
    queryFn: async ({ pageParam }) => fetchSaved(await token(), pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });
  // Un-saving removes the row straight away, before the list reloads.
  const stories = (q.data?.pages.flatMap((p) => p.data) ?? []).filter((s) => savedIds.data?.has(s.id) ?? true);

  return (
    <div className="page">
      <PageHeader title="Saved" />
      <p className="hint page-intro">Stories you bookmarked, on every device you sign in on.</p>

      {q.isPending && <p className="hint">Loading your saved stories…</p>}
      {q.isError && (
        <div className="inline-error" role="alert">
          <p>{q.error.message}</p>
          <button type="button" className="secondary" onClick={() => void q.refetch()}>Try again</button>
        </div>
      )}
      {q.isSuccess && stories.length === 0 && (
        <div className="empty">
          <p>Nothing saved yet.</p>
          <p className="hint">Tap the bookmark on any story to keep it here.</p>
          <Link className="primary" href="/">Browse stories</Link>
        </div>
      )}

      {stories.length > 0 && (
        <ul className="rows" aria-label="Saved stories">
          {stories.map((s) => (
            <StoryRow
              key={s.id}
              story={s}
              onRead={markRead && ((watched) => markRead(s, watched))}
              remove={{ label: 'Remove', onClick: () => saveProps(s.id)?.toggle() }}
            />
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <button type="button" className="secondary more" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
