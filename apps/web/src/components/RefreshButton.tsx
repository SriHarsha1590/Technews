import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRefreshStatus, startRefresh } from '../api';
import { useAuth } from '../auth';
import { Icon } from './Icon';

interface Props {
  onUpdate: () => void; // new cards were published (mid-run or at the end): reload the feed
}

/** Starts the scrape -> summarize -> Try it pipeline on the worker and shows new cards as each batch lands. */
export function RefreshButton({ onUpdate }: Props) {
  const queryClient = useQueryClient();
  const { user, token } = useAuth();
  const [message, setMessage] = useState('');
  const [batches, setBatches] = useState(0); // feed updates seen during this run
  const watching = useRef(false); // follow a run already active when the admin opens this page, too
  const lastVersion = useRef<number | null>(null);

  // Polls while the admin page is open, so scheduled runs that start later also appear.
  const status = useQuery({
    queryKey: ['refresh'],
    queryFn: fetchRefreshStatus,
    refetchInterval: 3000,
    retry: false,
  });

  const start = useMutation({
    mutationFn: async () => startRefresh(await token()),
    onSuccess: (data) => {
      watching.current = true;
      lastVersion.current = data.feedVersion;
      setBatches(0);
      setMessage('');
      queryClient.setQueryData(['refresh'], data);
    },
    onError: (err) => setMessage(err.message),
  });

  useEffect(() => {
    const data = status.data;
    if (!data) return;
    if (data.state === 'running' && !watching.current) {
      watching.current = true;
      lastVersion.current = data.feedVersion;
      setBatches(0);
      setMessage('');
      return;
    }
    if (!watching.current) return;
    if (data.feedVersion !== lastVersion.current) {
      lastVersion.current = data.feedVersion;
      setBatches((n) => n + 1);
      onUpdate(); // a batch of summaries is in: show it without waiting for the rest
    }
    if (data.state === 'running') return;
    watching.current = false;
    if (data.state === 'completed') {
      setMessage('Feed updated');
      onUpdate(); // Try it links are added after the last batch
    } else {
      setMessage('Refresh failed. Check the worker logs.');
    }
  }, [status.data, onUpdate]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 6000);
    return () => clearTimeout(t);
  }, [message]);

  if (!user) return null; // starting a run spends AI quota, so only signed-in readers can

  const busy = status.isPending || status.data?.state === 'running' || start.isPending;
  return (
    <div className="refresh">
      <button
        type="button"
        className="ask-top"
        onClick={() => start.mutate()}
        disabled={busy}
        title="Scrape the sources, summarize and update the feed now"
      >
        <span className={busy ? 'spin' : undefined}>
          <Icon name="replay" />
        </span>
        {status.data?.state === 'running' ? 'Pipeline running…' : start.isPending ? 'Starting pipeline…' : status.isPending ? 'Checking pipeline…' : 'Run news pipeline'}
      </button>
      <p className="refresh-note" role="status">
        {status.data?.state === 'running'
          ? (batches ? 'New stories published; the run continues.' : 'A pipeline run is in progress. This page follows it.')
          : start.isPending ? 'Starting a run…' : message}
      </p>
    </div>
  );
}
