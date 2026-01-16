/**
 * Standalone Gemini API Test Script
 *
 * Run from backend folder with: npm run test:gemini
 *
 * This script tests Vertex AI / Gemini connectivity independently
 * to isolate whether the issue is with:
 * 1. Gemini API connectivity
 * 2. Mastra agent layer
 * 3. Workflow orchestration
 */

import dotenv from 'dotenv';
dotenv.config();

import { Agent } from '@mastra/core/agent';
import { geminiModel } from '../mastra/model';

async function testSimpleAgentNoTools() {
  console.log('\n=== Test 1: Simple Agent (no tools) ===');

  // Create a minimal agent with no tools
  const simpleAgent = new Agent({
    id: 'test-agent',
    name: 'Test Agent',
    description: 'Simple test agent',
    instructions: 'You are a helpful assistant. Keep responses very short.',
    model: geminiModel,
    // NO TOOLS
  });

  console.log('Created simple agent without tools');
  const startTime = Date.now();

  try {
    const res = await simpleAgent.generate([
      {
        role: 'user',
        content: 'Say "Simple agent works!" and nothing else.',
      },
    ]);

    console.log('✅ SUCCESS in', Date.now() - startTime, 'ms');
    console.log('Response text:', (res as any)?.text);
    console.log('Response keys:', Object.keys(res || {}));
    return true;
  } catch (error: any) {
    console.log('❌ FAILED after', Date.now() - startTime, 'ms');
    console.log('Error name:', error?.name);
    console.log('Error message:', error?.message);
    console.log('Error stack:', error?.stack);
    return false;
  }
}

async function testSimpleAgentWithTimeout() {
  console.log('\n=== Test 2: Simple Agent with 30s Timeout ===');

  const simpleAgent = new Agent({
    id: 'test-agent-timeout',
    name: 'Test Agent Timeout',
    description: 'Simple test agent',
    instructions: 'You are a helpful assistant.',
    model: geminiModel,
  });

  const startTime = Date.now();

  // Create a promise that rejects after timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: Agent did not respond within 30 seconds'));
    }, 30_000);
  });

  try {
    const res = await Promise.race([
      simpleAgent.generate([
        {
          role: 'user',
          content: 'Return JSON: {"status": "ok"}',
        },
      ]),
      timeoutPromise,
    ]);

    console.log('✅ SUCCESS in', Date.now() - startTime, 'ms');
    console.log('Response text:', (res as any)?.text);
    return true;
  } catch (error: any) {
    console.log('❌ FAILED after', Date.now() - startTime, 'ms');
    console.log('Error message:', error?.message);
    if (error?.message?.includes('TIMEOUT')) {
      console.log('🔴 Gemini API is not responding - this confirms the hang issue');
    }
    return false;
  }
}

async function testMastraAgent() {
  console.log('\n=== Test 3: Via Mastra paperPlannerAgent ===');

  // Import mastra instance
  const { mastra } = await import('../mastra/index');

  const agent = mastra.getAgent('paperPlannerAgent');
  if (!agent) {
    console.log('❌ paperPlannerAgent not found');
    return false;
  }

  console.log('Agent found:', agent.name);
  console.log('Starting agent.generate() call...');

  const startTime = Date.now();

  // Create a promise that rejects after timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('TIMEOUT: paperPlannerAgent did not respond within 30 seconds'));
    }, 30_000);
  });

  try {
    const res = await Promise.race([
      agent.generate([
        {
          role: 'user',
          content: 'Say "Agent is working!" and nothing else.',
        },
      ]),
      timeoutPromise,
    ]);

    console.log('✅ SUCCESS in', Date.now() - startTime, 'ms');
    console.log('Response text:', (res as any)?.text);
    console.log('Response keys:', Object.keys(res || {}));
    return true;
  } catch (error: any) {
    console.log('❌ FAILED after', Date.now() - startTime, 'ms');
    console.log('Error name:', error?.name);
    console.log('Error message:', error?.message);
    if (error?.message?.includes('TIMEOUT')) {
      console.log('🔴 paperPlannerAgent is hanging - likely due to webSearchTool or Gemini issue');
    }
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('   GEMINI API CONNECTIVITY TEST');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());
  console.log('Node version:', process.version);

  // Check env vars
  console.log('\n--- Environment Check ---');
  console.log('GOOGLE_VERTEX_PROJECT:', process.env.GOOGLE_VERTEX_PROJECT ? '✓ set' : '✗ missing');
  console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? '✓ set' : '✗ missing');
  console.log('GOOGLE_CLIENT_EMAIL:', process.env.GOOGLE_CLIENT_EMAIL ? '✓ set' : '✗ missing');
  console.log('GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? '✓ set (length: ' + process.env.GOOGLE_PRIVATE_KEY.length + ')' : '✗ missing');

  const results: Record<string, boolean> = {};

  // Run tests sequentially
  results['Simple Agent (no tools)'] = await testSimpleAgentNoTools();
  results['Simple Agent (30s timeout)'] = await testSimpleAgentWithTimeout();
  results['Mastra paperPlannerAgent'] = await testMastraAgent();

  // Summary
  console.log('\n========================================');
  console.log('   TEST SUMMARY');
  console.log('========================================');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  }

  console.log('\n--- Diagnosis ---');
  if (!results['Simple Agent (no tools)']) {
    console.log('🔴 Basic Gemini connectivity is broken - check credentials and network');
  } else if (!results['Simple Agent (30s timeout)']) {
    console.log('🔴 Gemini API is slow/hanging - may be rate limited or network issue');
  } else if (!results['Mastra paperPlannerAgent']) {
    console.log('🟡 paperPlannerAgent has issues - likely webSearchTool is causing hangs');
  } else {
    console.log('🟢 All tests passed - issue may be in workflow orchestration');
  }

  const allPassed = Object.values(results).every(v => v);
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
