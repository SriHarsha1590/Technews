import { NativeConnection, Worker } from '@temporalio/worker';
import { writeFileSync } from 'node:fs';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import * as activities from './activities';
import { ensureIndexes, closeConnections } from './db';
import { config, TASK_QUEUE, LLM_TASK_QUEUE } from './config';
import { getClient } from './client';
import { ensureSchedules } from './schedules';
import { opsLog } from './ops-log';

async function run() {
  await ensureIndexes();
  const temporal = loadClientConnectConfig();
  const connection = await NativeConnection.connect(temporal.connectionOptions);

  // shortcut: workflowsPath bundles on startup (a few seconds); use a prebuilt bundle when we containerize.
  const main = await Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  // Only AI calls run here. The limit applies across every worker on this queue, keeping us under Gemini's free tier.
  const llm = await Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue: LLM_TASK_QUEUE,
    activities: { summarizeGroups: activities.summarizeGroups, classifyTryLinks: activities.classifyTryLinks },
    maxTaskQueueActivitiesPerSecond: config.llmCallsPerSecond,
  });

  // The pipeline runs every 5 minutes for as long as this worker is up; no separate `npm run schedules` needed.
  const client = await getClient();
  try {
    await ensureSchedules(client);
  } catch (err) {
    opsLog('warn', 'schedule_setup_failed', { errorName: err instanceof Error ? err.name : 'UnknownError' });
  } finally {
    await client.connection.close();
  }

  opsLog('info', 'worker_started', { taskQueue: TASK_QUEUE, llmTaskQueue: LLM_TASK_QUEUE, callsPerSecond: config.llmCallsPerSecond, model: config.geminiModel });
  const heartbeat = () => writeFileSync('/tmp/technews-worker-health', String(Date.now()));
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 20_000);
  try {
    await Promise.all([main.run(), llm.run()]);
  } finally {
    clearInterval(heartbeatTimer);
    await connection.close();
    await closeConnections();
  }
}

run().catch((err) => {
  opsLog('error', 'worker_failed', { errorName: err instanceof Error ? err.name : 'UnknownError' });
  process.exit(1);
});
