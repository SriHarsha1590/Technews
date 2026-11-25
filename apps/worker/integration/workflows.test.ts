import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

test('an exhausted AI allocation leaves pending stories unsaved and still rebuilds the feed', async () => {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  let saved = false;
  const activities = {
    loadPendingArticles: async () => [{ title: 'Pending story' }],
    assignToStories: async () => ({ attached: 0, groups: [[{ title: 'Pending story' }]] }),
    buildContexts: async () => [],
    summarizeGroups: async () => ({ capped: true }),
    saveStories: async () => { saved = true; return []; },
    rebuildFeeds: async () => ({ all: 3 }),
  };
  try {
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: 'integration', workflowsPath: require.resolve('../src/workflows'), activities });
    const llm = await Worker.create({ connection: env.nativeConnection, taskQueue: 'llm', activities });
    const result = await llm.runUntil(worker.runUntil(env.client.workflow.execute('summarizeWorkflow', {
      workflowId: 'capped-summary', taskQueue: 'integration',
    })));
    assert.equal(saved, false);
    assert.deepEqual(result, { pending: 1, attachedToExisting: 0, newStories: 0, capped: true, feeds: { all: 3 } });
  } finally { await env.teardown(); }
});
