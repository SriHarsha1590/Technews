// Starts the worker's refreshWorkflow (scrape -> summarize -> Try it links) and reports on it.
// The API never runs the pipeline itself: it only asks Temporal to, and the worker does the work.
import { Client, Connection, ScheduleNotFoundError, ScheduleOverlapPolicy, WorkflowNotFoundError } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import type { RefreshStatus } from '@technews/shared';

export class RefreshUnavailable extends Error {}

export type RunStatus = Omit<RefreshStatus, 'feedVersion'>; // the API adds feedVersion from Redis

export interface Refresher {
  start(): Promise<RunStatus>;
  status(): Promise<RunStatus>;
}

const SCHEDULE_ID = 'pipeline'; // created by the worker; one source of truth for scheduled and button-triggered runs
const UNAVAILABLE = 'Refresh is unavailable: the pipeline schedule or Temporal is not reachable.';

export function temporalRefresher(): Refresher {
  let client: Promise<Client> | undefined;
  const getClient = () =>
    (client ??= (async () => {
      const temporal = loadClientConnectConfig();
      const connection = await Connection.connect(temporal.connectionOptions);
      return new Client({ connection, namespace: temporal.namespace });
    })().catch((err) => {
      client = undefined; // Temporal was down: connect again next time
      throw err;
    }));

  async function status(): Promise<RunStatus> {
    try {
      const temporal = await getClient();
      const schedule = await temporal.schedule.getHandle(SCHEDULE_ID).describe();
      const active = schedule.info.runningActions.at(-1);
      const latest = active ?? schedule.info.recentActions.at(-1)?.action;
      if (!latest) return { state: 'idle', startedAt: null, finishedAt: null };
      const d = await temporal.workflow.getHandle(latest.workflow.workflowId).describe();
      const state = d.status.name === 'RUNNING' ? 'running' : d.status.name === 'COMPLETED' ? 'completed' : 'failed';
      return { state, startedAt: d.startTime.toISOString(), finishedAt: d.closeTime?.toISOString() ?? null };
    } catch (err) {
      if (err instanceof WorkflowNotFoundError || err instanceof ScheduleNotFoundError) return { state: 'idle', startedAt: null, finishedAt: null };
      throw new RefreshUnavailable(UNAVAILABLE);
    }
  }

  return {
    async start() {
      try {
        const before = await status();
        await (await getClient()).schedule.getHandle(SCHEDULE_ID).trigger(ScheduleOverlapPolicy.SKIP);
        // A trigger is accepted before its workflow appears in recentActions.
        // Wait briefly so the button sees the new run and keeps polling it.
        for (let attempt = 0; attempt < 20; attempt++) {
          const current = await status();
          if (current.state === 'running' || current.startedAt !== before.startedAt) return current;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return status();
      } catch {
        throw new RefreshUnavailable(UNAVAILABLE);
      }
    },
    status,
  };
}
