import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { HistoryEntry, HistoryFilter } from '@technews/shared';
import { useAuth, type AuthUser } from '../auth';
import { clearHistory, fetchHistory, removeFromHistory } from '../api';
import { useReadTracking } from '../history';
import { Link } from '../router';
import { PageHeader, StoryRow } from './StoryRow';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Today", "Yesterday", or a date like "Mon, Oct 20". */
export function dayLabel(iso: string, now = new Date()): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(new Date(iso))) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Everything this reader opened or watched, newest first, grouped by day. Private to their account. */
export function HistoryPage({ user, filter }: { user: AuthUser; filter: HistoryFilter }) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { markRead } = useReadTracking();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');

  const q = useInfiniteQuery({
    queryKey: ['history', user.uid, filter],
    queryFn: async ({ pageParam }) => fetchHistory(await token(), filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });

  // A story removed from History shows up in the feed again.
  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['history'] });
    void qc.invalidateQueries({ queryKey: ['read-ids'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };
  const remove = useMutation({
    mutationFn: async (id: string) => removeFromHistory(await token(), id),
    onMutate: (id) => setRemoved((r) => new Set(r).add(id)),
    onError: (err, id) => {
      setRemoved((r) => {
        const next = new Set(r);
        next.delete(id);
        return next;
      });
      setNote(err.message);
    },
    onSuccess: changed,
  });
  const clear = useMutation({
    mutationFn: async () => clearHistory(await token()),
    onSuccess: () => {
      setConfirming(false);
      setNote('History cleared.');
      changed();
    },
    onError: (err) => setNote(err.message),
  });

  const entries = (q.data?.pages.flatMap((p) => p.data) ?? []).filter((e) => !removed.has(e.story.id));
  const when = (e: HistoryEntry) => (filter === 'watched' && e.watchedAt ? e.watchedAt : e.readAt);
  const groups: { label: string; entries: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(when(e));
    if (groups.at(-1)?.label === label) groups.at(-1)!.entries.push(e);
    else groups.push({ label, entries: [e] });
  }

  return (
    <div className="page">
      <PageHeader title="History">
        {entries.length > 0 && !confirming && (
          <button type="button" className="secondary small" onClick={() => setConfirming(true)}>Clear history</button>
        )}
      </PageHeader>
      <p className="hint page-intro">
        What you've read and watched. These stories stay out of your feed; remove one here to see it there again.
      </p>

      {confirming && (
        <div className="confirm" role="alertdialog" aria-labelledby="clear-title">
          <p id="clear-title">Clear your whole history? Stories you've read will show up in your feed again.</p>
          <div className="confirm-actions">
            <button type="button" className="primary danger" disabled={clear.isPending} onClick={() => clear.mutate()}>
              {clear.isPending ? 'Clearing…' : 'Clear history'}
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}

      <nav className="filters" aria-label="Show">
        <Link className="chip" href="/history" aria-current={filter === 'all' ? 'page' : undefined}>Everything</Link>
        <Link className="chip" href="/history?filter=watched" aria-current={filter === 'watched' ? 'page' : undefined}>Watched</Link>
      </nav>
      <p className="status" role="status">{note}</p>

      {q.isPending && <p className="hint">Loading your history…</p>}
      {q.isError && (
        <div className="inline-error" role="alert">
          <p>{q.error.message}</p>
          <button type="button" className="secondary" onClick={() => void q.refetch()}>Try again</button>
        </div>
      )}
      {q.isSuccess && entries.length === 0 && (
        <div className="empty">
          <p>{filter === 'watched' ? "You haven't watched any stories yet." : 'Nothing here yet.'}</p>
          <p className="hint">
            {filter === 'watched'
              ? 'Press Watch on a story for a one-minute video; it will be listed here.'
              : 'Stories you read or watch while signed in are listed here.'}
          </p>
          <Link className="primary" href="/">Browse stories</Link>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.label} className="day" aria-label={g.label}>
          <h3 className="day-label">{g.label}</h3>
          <ul className="rows">
            {g.entries.map((e) => (
              <StoryRow
                key={e.story.id}
                story={e.story}
                meta={
                  <>
                    <span>{filter === 'watched' ? 'Watched' : 'Read'} {time(when(e))}</span>
                    {filter === 'all' && e.watchedAt && <span className="badge">Watched</span>}
                  </>
                }
                onRead={markRead && ((watched) => markRead(e.story, watched))}
                remove={{ label: 'Remove', onClick: () => remove.mutate(e.story.id) }}
              />
            ))}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <button type="button" className="secondary more" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  );
}
