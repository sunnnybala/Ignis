/**
 * Test if PinoLogger or agent count causes the hang
 *
 * Run: npx ts-node-dev --transpile-only src/scripts/test-mastra-logger.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { Mastra } from '@mastra/core/mastra';
import { Agent } from '@mastra/core/agent';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
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

const testAgent = new Agent({
  id: 'test-paper-planner',
  name: 'Test Paper Planner',
  description: 'Test agent',
  instructions: 'You are helpful.',
  model: geminiModel,
  tools: { webSearchTool },
});

async function testWithPinoLogger() {
  console.log('\n=== Test 1: With PinoLogger ===');

  const mastra = new Mastra({
    agents: { testAgent },
    storage: new LibSQLStore({ id: 'test', url: ':memory:' }),
    observability: new Observability({ default: { enabled: true } }),
    logger: new PinoLogger({ name: 'Test', level: 'debug' }),
  });

  const agent = mastra.getAgent('testAgent');
  const start = Date.now();
  try {
    const res = await withTimeout(
      agent!.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'with pino logger'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testWithManyAgents() {
  console.log('\n=== Test 2: With Many Agents (no workflows) ===');

  // Create multiple dummy agents like production
  const agents: Record<string, Agent> = { testAgent };
  for (let i = 0; i < 13; i++) {
    agents[`dummyAgent${i}`] = new Agent({
      id: `dummy-${i}`,
      name: `Dummy ${i}`,
      description: 'Dummy',
      instructions: 'Dummy',
      model: geminiModel,
    });
  }

  const mastra = new Mastra({
    agents,
    storage: new LibSQLStore({ id: 'test2', url: ':memory:' }),
    observability: new Observability({ default: { enabled: true } }),
    logger: new PinoLogger({ name: 'Test', level: 'debug' }),
  });

  const agent = mastra.getAgent('testAgent');
  const start = Date.now();
  try {
    const res = await withTimeout(
      agent!.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'with many agents'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testWithWorkflows() {
  console.log('\n=== Test 3: With Workflows (production-like) ===');

  // Import actual workflows
  const { paperPlanWriteWorkflow } = await import('../mastra/workflows/paper-plan-write-workflow');

  const mastra = new Mastra({
    agents: { testAgent },
    workflows: { paperPlanWriteWorkflow },
    storage: new LibSQLStore({ id: 'test3', url: ':memory:' }),
    observability: new Observability({ default: { enabled: true } }),
    logger: new PinoLogger({ name: 'Test', level: 'debug' }),
  });

  const agent = mastra.getAgent('testAgent');
  const start = Date.now();
  try {
    const res = await withTimeout(
      agent!.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'with workflows'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testWithActualAgents() {
  console.log('\n=== Test 4: With Actual Production Agents (no workflows) ===');

  // Import actual agents
  const { paperPlannerAgent } = await import('../mastra/agents/paper-planner-agent');
  const { vfsAgent } = await import('../mastra/agents/vfs-agent');
  const { researchAgent } = await import('../mastra/agents/research-agent');

  const mastra = new Mastra({
    agents: { paperPlannerAgent, vfsAgent, researchAgent },
    // NO workflows
    storage: new LibSQLStore({ id: 'test4', url: ':memory:' }),
    observability: new Observability({ default: { enabled: true } }),
    logger: new PinoLogger({ name: 'Test', level: 'debug' }),
  });

  const agent = mastra.getAgent('paperPlannerAgent');
  const start = Date.now();
  try {
    const res = await withTimeout(
      agent!.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'with actual agents'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function testWithRouterAgent() {
  console.log('\n=== Test 5: With Router Agent (has workflow imports) ===');

  // The router agent imports workflows which might cause circular deps
  const { ignisRouterAgent } = await import('../mastra/agents/ignis-router-agent');
  const { paperPlannerAgent } = await import('../mastra/agents/paper-planner-agent');

  const mastra = new Mastra({
    agents: { ignisRouterAgent, paperPlannerAgent },
    storage: new LibSQLStore({ id: 'test5', url: ':memory:' }),
    observability: new Observability({ default: { enabled: true } }),
    logger: new PinoLogger({ name: 'Test', level: 'debug' }),
  });

  const agent = mastra.getAgent('paperPlannerAgent');
  const start = Date.now();
  try {
    const res = await withTimeout(
      agent!.generate([{ role: 'user', content: TEST_PROMPT }]),
      TIMEOUT_MS,
      'with router agent'
    );
    console.log(`✅ SUCCESS in ${Date.now() - start}ms`);
    return true;
  } catch (e: any) {
    console.log(`❌ FAILED after ${Date.now() - start}ms:`, e.message);
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('   LOGGER/AGENT COUNT TEST');
  console.log('========================================');

  const results: Record<string, boolean> = {};

  results['With PinoLogger'] = await testWithPinoLogger();
  results['With Many Agents'] = await testWithManyAgents();
  results['With Workflows'] = await testWithWorkflows();
  results['With Actual Agents'] = await testWithActualAgents();
  results['With Router Agent'] = await testWithRouterAgent();

  console.log('\n========================================');
  console.log('   SUMMARY');
  console.log('========================================');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  }
}

main().catch(console.error);
