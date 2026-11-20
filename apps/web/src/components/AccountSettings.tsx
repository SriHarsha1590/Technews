import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@technews/shared';
import { useAuth } from '../auth';
import { fetchMe, fetchPopularTags, putDigest, putStack } from '../api';
import { disablePush, enablePush } from '../push';

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' }),
}));
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function useMe() {
  const { user, token } = useAuth();
  return useQuery({ queryKey: ['me', user?.uid], queryFn: async () => fetchMe(await token()), enabled: Boolean(user) });
}

/** My stack: the technologies "For you" follows. */
export function StackSettings() {
  const { user, token } = useAuth();
  const qc = useQueryClient();
  const me = useMe();
  const popular = useQuery({ queryKey: ['popular-tags'], queryFn: fetchPopularTags, staleTime: 15 * 60_000 });

  const [stack, setStack] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');

  // Start from the saved stack once (not after every save, or the "Saved" note would vanish).
  const loaded = useRef(false);
  useEffect(() => {
    if (me.data && !loaded.current) {
      loaded.current = true;
      setStack(me.data.stack);
    }
  }, [me.data]);

  const save = useMutation({
    mutationFn: async () => putStack(await token(), stack),
    onSuccess: ({ data }) => {
      qc.setQueryData<Me>(['me', user?.uid], (m) => (m ? { ...m, stack: data.stack } : m));
      void qc.invalidateQueries({ queryKey: ['foryou'] });
      setNote('Saved. "For you" now follows these.');
    },
    onError: (e: Error) => setNote(e.message),
  });

  const toggleTag = (tag: string) => setStack((s) => (s.includes(tag) ? s.filter((t) => t !== tag) : [...s, tag]));
  const addCustom = () => {
    const tag = custom.trim().toLowerCase();
    if (tag && !stack.includes(tag)) setStack((s) => [...s, tag]);
    setCustom('');
  };

  // Chips: popular tags first, then anything the reader added that isn't popular right now.
  const chips = [...new Set([...(popular.data ?? []).map((p) => p.tag), ...stack])];

  return (
    <section className="settings-section" id="stack" aria-labelledby="stack-title">
      <h3 id="stack-title">My stack</h3>
      <p className="hint">Pick what you work with. "For you" shows what's new in these.</p>
      <div className="chips">
        {chips.map((tag) => (
          <button key={tag} type="button" className="chip" aria-pressed={stack.includes(tag)} onClick={() => toggleTag(tag)}>
            {tag}
          </button>
        ))}
        {popular.isPending && <span className="hint">Loading topics…</span>}
      </div>
      <div className="field">
        <label htmlFor="custom-tag" className="sr-only">Add a technology</label>
        <input
          id="custom-tag"
          value={custom}
          maxLength={40}
          placeholder="Add a technology, e.g. rust"
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
        />
        <button type="button" className="secondary" onClick={addCustom} disabled={!custom.trim()}>
          Add
        </button>
      </div>
      <button type="button" className="primary" onClick={() => save.mutate()} disabled={save.isPending || !me.data || stack.length > 20}>
        {save.isPending ? 'Saving…' : 'Save my stack'}
      </button>
      {stack.length > 20 && <p className="hint">Pick up to 20.</p>}
      <p className="status" role="status">{note}</p>
    </section>
  );
}

/** Daily digest: one notification a day, at the reader's chosen hour. */
export function DigestSettings() {
  const { user, token } = useAuth();
  const qc = useQueryClient();
  const me = useMe();
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: async (next: Me['digest']) => {
      const t = await token();
      const turningOn = next.enabled && !me.data?.digest.enabled;
      if (turningOn) await enablePush(t); // asks the browser for permission first
      if (!next.enabled && me.data?.digest.enabled) await disablePush(t);
      return (await putDigest(t, next)).data;
    },
    onSuccess: (digest) => {
      qc.setQueryData<Me>(['me', user?.uid], (m) => (m ? { ...m, digest } : m));
      setNote(digest.enabled ? `Daily digest on, at ${HOURS[digest.hour].label} your time.` : 'Daily digest off.');
    },
    onError: (e: Error) => setNote(e.message),
  });

  const digest = me.data?.digest;
  return (
    <section className="settings-section settings" aria-labelledby="digest-title">
      <h3 id="digest-title">Daily digest</h3>
      <p className="hint">One notification a day with the top stories in your stack.</p>
      <label className="check">
        <input
          type="checkbox"
          checked={digest?.enabled ?? false}
          disabled={!digest || save.isPending}
          onChange={(e) => digest && save.mutate({ ...digest, enabled: e.target.checked, timeZone: localZone() })}
        />
        Send me a daily digest
      </label>
      <label className="field-label" htmlFor="digest-hour">Time</label>
      <select
        id="digest-hour"
        value={digest?.hour ?? 8}
        disabled={!digest || save.isPending}
        onChange={(e) => digest && save.mutate({ ...digest, hour: Number(e.target.value), timeZone: localZone() })}
      >
        {HOURS.map((h) => (
          <option key={h.value} value={h.value}>{h.label}</option>
        ))}
      </select>
      <p className="status" role="status">{note}</p>
    </section>
  );
}
