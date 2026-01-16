/**
 * Test with minimal Mastra config (no observability/storage)
 *
 * Run: npx ts-node-dev --transpile-only src/scripts/test-mastra-minimal.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Mastra } from '@mastra/core/mastra';
import { Agent } from '@mastra/core/agent';
import { geminiModel } from '../mastra/model';
import { webSearchTool } from '../mastra/tools/web-search';

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

// Create the same agent as paperPlannerAgent
const testAgent = new Agent({
  id: 'test-paper-planner',
  name: 'Test Paper Planner',
  description: 'Test agent with same config as paperPlannerAgent',
  instructions: 'You are helpful.',
  model: geminiModel,
  tools: { webSearchTool },
});

async function testMinimalMastra() {
  console.log('\n=== Test 1: Minimal Mastra (NO storage, NO observability) ===');

  const minimalMastra = new Mastra({
    agents: { testAgent },
    // NO storage
    // NO observability
    // NO logger
  });

  const agent = minimalMastra.getAgent('testAgent');
  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'minimal mastra agent'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testMastraWithStorageOnly() {
  console.log('\n=== Test 2: Mastra with LibSQLStore (NO observability) ===');

  const { LibSQLStore } = await import('@mastra/libsql');

  const mastraWithStorage = new Mastra({
    agents: { testAgent },
    storage: new LibSQLStore({
      id: 'test-storage',
      url: ':memory:',
    }),
    // NO observability
  });

  const agent = mastraWithStorage.getAgent('testAgent');
  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'mastra with storage'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testMastraWithObservabilityOnly() {
  console.log('\n=== Test 3: Mastra with Observability (NO storage) ===');

  const { Observability } = await import('@mastra/observability');

  const mastraWithObs = new Mastra({
    agents: { testAgent },
    // NO storage
    observability: new Observability({
      default: { enabled: true },
    }),
  });

  const agent = mastraWithObs.getAgent('testAgent');
  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'mastra with observability'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testMastraWithBoth() {
  console.log('\n=== Test 4: Mastra with BOTH Storage + Observability ===');

  const { LibSQLStore } = await import('@mastra/libsql');
  const { Observability } = await import('@mastra/observability');

  const mastraFull = new Mastra({
    agents: { testAgent },
    storage: new LibSQLStore({
      id: 'test-storage-full',
      url: ':memory:',
    }),
    observability: new Observability({
      default: { enabled: true },
    }),
  });

  const agent = mastraFull.getAgent('testAgent');
  if (!agent) {
    console.log('❌ Agent not found');
    return false;
  }

  const start = Date.now();
  try {
    const res = await withTimeout(
      agent.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'mastra with both'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    console.log('Response:', (res as any)?.text?.slice(0, 100));
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testProductionMastra() {
  console.log('\n=== Test 5: Production Mastra (from index.ts) ===');

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
      'production mastra'
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
  console.log('   MASTRA CONFIG ISOLATION TEST');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());

  const results: Record<string, boolean> = {};

  results['Minimal (no storage/obs)'] = await testMinimalMastra();
  results['Storage only'] = await testMastraWithStorageOnly();
  results['Observability only'] = await testMastraWithObservabilityOnly();
  results['Both storage + obs'] = await testMastraWithBoth();
  results['Production mastra'] = await testProductionMastra();

  console.log('\n========================================');
  console.log('   SUMMARY');
  console.log('========================================');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  }

  console.log('\n=== DIAGNOSIS ===');
  if (!results['Minimal (no storage/obs)']) {
    console.log('🔴 Issue is with Mastra core itself, not storage/observability');
  } else if (!results['Storage only']) {
    console.log('🔴 LibSQLStore is causing the hang');
  } else if (!results['Observability only']) {
    console.log('🔴 Observability is causing the hang');
  } else if (!results['Both storage + obs']) {
    console.log('🔴 Combination of storage + observability causes hang');
  } else if (!results['Production mastra']) {
    console.log('🟡 Production config has additional issue (logger? workflows?)');
  } else {
    console.log('🟢 All configurations work');
  }
}

main().catch(console.error);
