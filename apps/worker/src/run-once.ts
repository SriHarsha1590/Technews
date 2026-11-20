// Usage: npm run ingest | summarize | try-links | refresh | recheck-try-links | digest  (from the repo root)
import { getClient } from './client';
import { ingestAllWorkflow, summarizeWorkflow, tryLinksWorkflow, refreshWorkflow, recheckTryLinksWorkflow, digestWorkflow } from './workflows';
import { TASK_QUEUE } from './config';

const WORKFLOWS = {
  ingest: ingestAllWorkflow,
  summarize: summarizeWorkflow,
  'try-links': tryLinksWorkflow,
  refresh: refreshWorkflow,
  'recheck-try-links': recheckTryLinksWorkflow,
  digest: digestWorkflow,
};

async function run() {
  const name = process.argv[2] as keyof typeof WORKFLOWS;
  const workflow = WORKFLOWS[name];
  if (!workflow) throw new Error(`Usage: run-once <${Object.keys(WORKFLOWS).join('|')}>`);

  const client = await getClient();
  const result = await client.workflow.execute(workflow, { workflowId: `${name}-manual-${Date.now()}`, taskQueue: TASK_QUEUE });
  console.log(JSON.stringify(result, null, 2));
  await client.connection.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
