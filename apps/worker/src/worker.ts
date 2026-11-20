import { NativeConnection, Worker } from '@temporalio/worker';
import { loadClientConnectConfig } from '@temporalio/envconfig';
import * as activities from './activities';
import { ensureIndexes, closeConnections } from './db';
import { config, TASK_QUEUE, LLM_TASK_QUEUE } from './config';
import { getClient } from './client';
import { ensureSchedules } from './schedules';

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
    console.warn('could not set up schedules; run `npm run schedules` later', err);
  } finally {
    await client.connection.close();
  }

  console.log(`Worker running. Queues: ${TASK_QUEUE}, ${LLM_TASK_QUEUE} (${config.llmCallsPerSecond} AI calls/sec, model ${config.geminiModel})`);
  try {
    await Promise.all([main.run(), llm.run()]);
  } finally {
    await connection.close();
    await closeConnections();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
