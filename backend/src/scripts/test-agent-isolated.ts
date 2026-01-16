/**
 * Isolated agent test - compares standalone agent vs mastra-registered agent
 *
 * Run: npx ts-node-dev --transpile-only src/scripts/test-agent-isolated.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Agent } from '@mastra/core/agent';
import { geminiModel } from '../mastra/model';

const TEST_PROMPT = 'Return a simple JSON: {"test": "hello"}';
const TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

async function testStandaloneAgentNoTools() {
  console.log('\n=== Test 1: Standalone Agent (NO tools, NO mastra) ===');

  const agent = new Agent({
    id: 'standalone-no-tools',
    name: 'Standalone No Tools',
    description: 'Test agent',
    instructions: 'You are helpful.',
    model: geminiModel,
    // NO tools
  });

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'standalone agent (no tools)'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testStandaloneAgentWithTools() {
  console.log('\n=== Test 2: Standalone Agent (WITH webSearchTool, NO mastra) ===');

  // Import the same tool that paperPlannerAgent uses
  const { webSearchTool } = await import('../mastra/tools/web-search');

  const agent = new Agent({
    id: 'standalone-with-tools',
    name: 'Standalone With Tools',
    description: 'Test agent',
    instructions: 'You are helpful.',
    model: geminiModel,
    tools: { webSearchTool },  // Same tool as paperPlannerAgent
  });

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'standalone agent (with tools)'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testMastraAgentDirectly() {
  console.log('\n=== Test 3: Mastra-registered paperPlannerAgent ===');

  // This is what test-workflow.ts does
  const { mastra } = await import('../mastra/index');
  const agent = mastra.getAgent('paperPlannerAgent');

  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'mastra paperPlannerAgent'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testMastraAgentAfterWarmup() {
  console.log('\n=== Test 4: Mastra agent AFTER standalone warmup ===');

  // First, run a standalone agent (like test-gemini.ts does)
  console.log('Running warmup with standalone agent...');
  const warmupAgent = new Agent({
    id: 'warmup',
    name: 'Warmup',
    description: 'Warmup',
    instructions: 'Say hi',
    model: geminiModel,
  });

  try {
    await withTimeout(
      warmupAgent.generate([{ role: 'user', content: 'Say "warmed up"' }]),
      TIMEOUT_MS,
      'warmup'
    );
    console.log('Warmup complete');
  } catch (e: any) {
    console.log('Warmup failed:', e.message);
    return false;
  }

  // Now test mastra agent
  const { mastra } = await import('../mastra/index');
  const agent = mastra.getAgent('paperPlannerAgent');

  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'mastra paperPlannerAgent after warmup'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('   AGENT ISOLATION TEST');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());

  const results: Record<string, boolean> = {};

  // Run tests in order
  results['Standalone (no tools)'] = await testStandaloneAgentNoTools();
  results['Standalone (with tools)'] = await testStandaloneAgentWithTools();
  results['Mastra agent (direct)'] = await testMastraAgentDirectly();
  // Skip test 4 if test 3 already passed
  if (!results['Mastra agent (direct)']) {
    results['Mastra agent (after warmup)'] = await testMastraAgentAfterWarmup();
  }

  console.log('\n========================================');
  console.log('   SUMMARY');
  console.log('========================================');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  }

  console.log('\n=== DIAGNOSIS ===');
  if (!results['Standalone (no tools)']) {
    console.log('🔴 Basic Gemini connectivity broken');
  } else if (!results['Standalone (with tools)']) {
    console.log('🔴 webSearchTool is causing the hang');
  } else if (!results['Mastra agent (direct)']) {
    if (results['Mastra agent (after warmup)']) {
      console.log('🟡 Mastra needs "warmup" - likely observability/storage init issue');
    } else {
      console.log('🔴 Mastra registration causes hang - check observability/storage config');
    }
  } else {
    console.log('🟢 All tests passed');
  }
}

main().catch(console.error);
