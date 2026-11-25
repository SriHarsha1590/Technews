// What the reader has read and watched, kept per account on the server.
// The feed hides stories read on an earlier visit (unless they're saved). Stories read during this visit
// stay on screen until the next one, so nothing vanishes while the reader scrolls.
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StoryCard } from '@technews/shared';
import { useAuth } from './auth';
import { useSavedIds } from './bookmarks';
import { fetchReadIds, recordRead } from './api';

/** A card counts as read after it has filled most of the screen for this long, or when any of its buttons is used. */
export const READ_AFTER_MS = 4000;
/** Coming back to the app after this long counts as reopening it. */
const AWAY_MS = 30 * 60_000;

export function useReadTracking() {
  const { user, token } = useAuth();
  const qc = useQueryClient();
  const sent = useRef(new Map<string, boolean>()); // story id -> watched, already recorded this visit

  useEffect(() => { sent.current.clear(); }, [user?.uid]);

  const readIds = useQuery({
    queryKey: ['read-ids', user?.uid],
    queryFn: async () => new Set(await fetchReadIds(await token())),
    enabled: Boolean(user),
    staleTime: Infinity, // only refreshed on a new visit, or after History changes
  });
  const savedIds = useSavedIds();

  const { mutate } = useMutation({
    mutationFn: async ({ story, watched }: { story: StoryCard; watched: boolean }) => recordRead(await token(), story.id, watched),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['history'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (_err, { story }) => sent.current.delete(story.id), // try again next time it's read
  });

  const markRead = useCallback(
    (story: StoryCard, watched = false) => {
      if (!user) return;
      const before = sent.current.get(story.id);
      if (before === true || (before === false && !watched)) return;
      sent.current.set(story.id, watched);
      mutate({ story, watched });
    },
    [user, mutate],
  );

  const hide = useCallback(
    (id: string) => Boolean(readIds.data?.has(id) && !savedIds.data?.has(id)),
    [readIds.data, savedIds.data],
  );

  return {
    /** Signed out: nothing is tracked or hidden. */
    markRead: user ? markRead : undefined,
    hide: user ? hide : undefined,
    /** False while we don't yet know what to hide; showing cards now would make some disappear a moment later. */
    ready: !user || (!readIds.isPending && !savedIds.isPending),
  };
}

/** Coming back after a long break: reload what was read, then the feed, so new stories are on top. */
export function useFreshOnReturn(onReturn: () => void) {
  const qc = useQueryClient();
  useEffect(() => {
    let hiddenAt = 0;
    const changed = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
        void qc.invalidateQueries({ queryKey: ['read-ids'] });
        onReturn();
      }
    };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, [qc, onReturn]);
}
