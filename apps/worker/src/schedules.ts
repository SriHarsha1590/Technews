// Usage: npm run schedules (the worker also runs this on startup, so the pipeline keeps going on its own).
import { ScheduleOverlapPolicy, ScheduleAlreadyRunning, ScheduleNotFoundError, type Client } from '@temporalio/client';
import { getClient } from './client';
import { TASK_QUEUE } from './config';

const SCHEDULES = [
  // ingest -> summarize -> images -> Try it links -> rank, all in one run (refreshWorkflow)
  { id: 'pipeline', workflowType: 'refreshWorkflow', every: '5 minutes' },
  { id: 'recheck-try-links', workflowType: 'recheckTryLinksWorkflow', every: '1 day' }, // re-checks links older than 7 days
  { id: 'digest', workflowType: 'digestWorkflow', every: '1 hour' }, // each reader gets it at their own local hour
] as const;

// Replaced by 'pipeline': deleted so the same work doesn't run twice.
const RETIRED = ['ingest-all', 'summarize', 'try-links'];

/** Creates the schedules, or updates them to match SCHEDULES if they already exist. Safe to run any number of times. */
export async function ensureSchedules(client: Client): Promise<void> {
  for (const s of SCHEDULES) {
    const spec = { intervals: [{ every: s.every }] };
    const action = {
      type: 'startWorkflow' as const,
      workflowType: s.workflowType,
      taskQueue: TASK_QUEUE,
      args: [],
      workflowExecutionTimeout: '30 minutes', // a stuck run can't block the schedule forever
    };
    const policies = { overlap: ScheduleOverlapPolicy.SKIP, catchupWindow: '1 minute' }; // never pile up runs, even after downtime
    try {
      await client.schedule.create({ scheduleId: s.id, spec, action, policies });
      console.log(`Created schedule "${s.id}": every ${s.every}`);
    } catch (err) {
      if (!(err instanceof ScheduleAlreadyRunning)) throw err;
      await client.schedule.getHandle(s.id).update((prev) => ({ ...prev, spec, action, policies: { ...prev.policies, ...policies } }));
      console.log(`Schedule "${s.id}": every ${s.every}`);
    }
  }
  for (const id of RETIRED) {
    try {
      await client.schedule.getHandle(id).delete();
      console.log(`Deleted old schedule "${id}"`);
    } catch (err) {
      if (!(err instanceof ScheduleNotFoundError)) throw err;
    }
  }
}

if (require.main === module) {
  (async () => {
    const client = await getClient();
    await ensureSchedules(client);
    await client.connection.close();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
