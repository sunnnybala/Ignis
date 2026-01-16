/**
 * Test paper-plan-write-workflow in isolation
 *
 * Run: npx ts-node-dev --transpile-only src/scripts/test-workflow.ts
 */

import dotenv from 'dotenv';
dotenv.config();

// IMPORTANT: Delay mastra import to match test-gemini.ts pattern
let mastra: any;

async function testWorkflowDirectly() {
  console.log('========================================');
  console.log('   WORKFLOW ISOLATION TEST');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());

  // Test 1: Get the workflow
  console.log('\n=== Test 1: Get workflow from mastra ===');
  // NOTE: Workflows are registered by their JS property name, not their internal id
  const workflow = mastra.getWorkflow('paperPlanWriteWorkflow');
  if (!workflow) {
    console.log('❌ Workflow not found');
    return;
  }
  console.log('✅ Workflow found:', workflow.name);

  // Test 2: Create a run with mock context
  console.log('\n=== Test 2: Create workflow run ===');

  // Create a mock requestContext that mimics what router.ts provides
  const mockRequestContext = new Map<string, any>();
  mockRequestContext.set('traceId', 'test-trace-' + Date.now());
  mockRequestContext.set('userId', 'test-user-id');
  mockRequestContext.set('projectId', 'test-project-id');

  const startTime = Date.now();

  // Add a timeout wrapper
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Workflow did not complete within 60 seconds'));
    }, 60_000);
  });

  try {
    console.log('Starting workflow.createRun()...');

    const run = workflow.createRun({
      requestContext: mockRequestContext,
    });

    console.log('Workflow run created, starting execution...');
    console.log('Run ID:', run.runId);

    const result = await Promise.race([
      run.start({
        inputData: { selectedJournal: 'General' },
      }),
      timeoutPromise,
    ]);

    console.log('\n✅ SUCCESS in', Date.now() - startTime, 'ms');
    console.log('Result:', JSON.stringify(result, null, 2).slice(0, 500));
  } catch (error: any) {
    console.log('\n❌ FAILED after', Date.now() - startTime, 'ms');
    console.log('Error name:', error?.name);
    console.log('Error message:', error?.message);

    if (error?.message?.includes('TIMEOUT')) {
      console.log('\n🔴 DIAGNOSIS: Workflow is hanging during execution');
      console.log('   The agent.generate() call inside a workflow step is not returning.');
      console.log('   This could be due to:');
      console.log('   1. Mastra workflow context interfering with agent execution');
      console.log('   2. Missing/malformed requestContext causing infinite wait');
      console.log('   3. Internal Mastra promise handling issue');
    }

    if (error?.message?.includes('Missing required file')) {
      console.log('\n🟡 DIAGNOSIS: Missing prerequisite files');
      console.log('   The workflow expects Research/refined_idea.md to exist.');
      console.log('   Run the novelty-refine workflow first, or create a mock file.');
    }
  }
}

async function testAgentInWorkflowContext() {
  console.log('\n========================================');
  console.log('   AGENT-IN-WORKFLOW CONTEXT TEST');
  console.log('========================================');

  // Import mastra LAZILY - this is key!
  console.log('Importing mastra lazily...');
  const mastraModule = await import('../mastra/index');
  mastra = mastraModule.mastra;
  console.log('Mastra imported');

  // Get the agent the same way the workflow does
  const agent = mastra.getAgent('paperPlannerAgent');
  if (!agent) {
    console.log('❌ Agent not found');
    return;
  }

  console.log('Agent found:', agent.name);

  // Simulate exactly what the workflow step does
  const startTime = Date.now();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Agent did not respond within 30 seconds'));
    }, 30_000);
  });

  try {
    console.log('Calling agent.generate() with minimal prompt...');

    const res = await Promise.race([
      agent.generate([
        {
          role: 'user',
          content: 'Return a simple JSON: {"test": "hello"}',
        },
      ]),
      timeoutPromise,
    ]);

    console.log('✅ SUCCESS in', Date.now() - startTime, 'ms');
    console.log('Response text:', (res as any)?.text?.slice(0, 200));
    return true;
  } catch (error: any) {
    console.log('❌ FAILED after', Date.now() - startTime, 'ms');
    console.log('Error:', error?.message);
    return false;
  }
}

async function main() {
  // First verify agent works outside workflow
  const agentWorks = await testAgentInWorkflowContext();

  if (!agentWorks) {
    console.log('\n🔴 Agent test failed - skipping workflow test');
    console.log('\n=== DIAGNOSIS ===');
    console.log('The agent hangs even with lazy import.');
    console.log('This suggests an issue with:');
    console.log('1. Mastra observability/tracing blocking the response');
    console.log('2. LibSQLStore async initialization not completing');
    console.log('3. PinoLogger or Observability creating a deadlock');
    console.log('\nTry running with observability disabled.');
    return;
  }

  // Then test the full workflow
  await testWorkflowDirectly();
}

main().catch(console.error);
