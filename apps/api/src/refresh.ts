// Starts the worker's refreshWorkflow (scrape -> summarize -> Try it links) and reports on it.
// The API never runs the pipeline itself: it only asks Temporal to, and the worker does the work.
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import type { RefreshStatus } from '@technews/shared';

export class RefreshUnavailable extends Error {}

export type RunStatus = Omit<RefreshStatus, 'feedVersion'>; // the API adds feedVersion from Redis

export interface Refresher {
  start(): Promise<RunStatus>;
  status(): Promise<RunStatus>;
}

const WORKFLOW_ID = 'refresh'; // one id: a second click while one is running joins it instead of starting another
const WORKFLOW_TYPE = 'refreshWorkflow'; // apps/worker/src/workflows.ts
const TASK_QUEUE = 'technews'; // keep in sync with the worker's config.ts
const UNAVAILABLE = 'Refresh is unavailable: Temporal is not reachable.';

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
      const d = await (await getClient()).workflow.getHandle(WORKFLOW_ID).describe();
      const state = d.status.name === 'RUNNING' ? 'running' : d.status.name === 'COMPLETED' ? 'completed' : 'failed';
      return { state, startedAt: d.startTime.toISOString(), finishedAt: d.closeTime?.toISOString() ?? null };
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) return { state: 'idle', startedAt: null, finishedAt: null };
      throw new RefreshUnavailable(UNAVAILABLE);
    }
  }

  return {
    async start() {
      try {
        await (await getClient()).workflow.start(WORKFLOW_TYPE, {
          workflowId: WORKFLOW_ID,
          taskQueue: TASK_QUEUE,
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowExecutionTimeout: '20 minutes', // worker down: the button stops spinning eventually
        });
      } catch {
        throw new RefreshUnavailable(UNAVAILABLE);
      }
      return status();
    },
    status,
  };
}
