// Which stories the reader saved, with instant (optimistic) toggling.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './auth';
import { fetchSavedIds, saveStory, unsaveStory } from './api';
import { navigate, signInHref } from './router';

/** Ids of every story the reader saved. */
export function useSavedIds() {
  const { user, token } = useAuth();
  return useQuery({
    queryKey: ['saved-ids', user?.uid],
    queryFn: async () => new Set(await fetchSavedIds(await token())),
    enabled: Boolean(user),
  });
}

export function useBookmarks() {
  const { enabled, user, token } = useAuth();
  const qc = useQueryClient();
  const key = ['saved-ids', user?.uid];
  const ids = useSavedIds();

  const toggle = useMutation({
    mutationFn: async ({ id, save }: { id: string; save: boolean }) => {
      const t = await token();
      return save ? saveStory(t, id) : unsaveStory(t, id);
    },
    // Flip the icon straight away; undo it if the server says no.
    onMutate: async ({ id, save }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Set<string>>(key);
      const next = new Set(before);
      if (save) next.add(id);
      else next.delete(id);
      qc.setQueryData(key, next);
      return { before };
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(key, ctx?.before),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['saved'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  /** Props for a card's Save button, or undefined when sign-in isn't available. */
  return (id: string) => {
    if (!enabled) return undefined;
    const saved = ids.data?.has(id) ?? false;
    return {
      saved,
      toggle: () => (user ? toggle.mutate({ id, save: !saved }) : navigate(signInHref())),
    };
  };
}
