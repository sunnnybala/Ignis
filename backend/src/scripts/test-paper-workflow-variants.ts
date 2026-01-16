/**
 * Test script to pinpoint what causes the paper workflow to hang.
 *
 * Run with: npx tsx src/scripts/test-paper-workflow-variants.ts
 *
 * Tests various combinations:
 * 1. .stream() + string prompt (CURRENT - working)
 * 2. .stream() + message array
 * 3. .generate() + string prompt (no structuredOutput)
 * 4. .generate() + string prompt + simple schema
 * 5. .generate() + string prompt + complex schema (plannerSchema)
 * 6. .generate() + message array + simple schema
 * 7. .generate() + message array + complex schema
 * 8. Agent with webSearchTool enabled
 */

import 'dotenv/config';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { geminiModel } from '../mastra/model';

// Timeout helper
const TIMEOUT_MS = 120_000; // 120 seconds

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

// Simple schema (like textOutSchema in novelty-refine)
const simpleSchema = z.object({
  text: z.string(),
});

// Medium schema (like plannerOutputSchema in plan-implement)
const mediumSchema = z.object({
  title: z.string(),
  sections: z.array(z.string()),
});

// Complex schema (like plannerSchema in paper-plan-write)
const complexSchema = z.object({
  selectedJournal: z.string(),
  paperTitleCandidates: z.array(z.string()).default([]),
  outline: z.array(z.object({
    sectionId: z.string(),
    bullets: z.array(z.string()).default([]),
  })).default([]),
  figurePlan: z.array(z.object({
    figureId: z.string(),
    imageUrl: z.string(),
    caption: z.string(),
    sectionId: z.string(),
  })).default([]),
});

// Schema with tuple (like latexSchema)
const tupleSchema = z.object({
  value: z.string(),
  probability: z.number().min(0).max(1),
  suggestions: z.tuple([z.string(), z.string(), z.string()]),
});

// Test prompt
const TEST_PROMPT = `You are a test agent. Return valid JSON.

Return a response matching this schema:
{
  "selectedJournal": "Test Journal",
  "paperTitleCandidates": ["Title 1", "Title 2"],
  "outline": [
    { "sectionId": "intro", "bullets": ["Introduction point 1", "Introduction point 2"] },
    { "sectionId": "methods", "bullets": ["Method 1"] }
  ],
  "figurePlan": []
}

Return ONLY the JSON, no markdown or explanation.`;

const SIMPLE_PROMPT = `Return this exact JSON: { "text": "Hello world" }`;

const MEDIUM_PROMPT = `Return this exact JSON: { "title": "Test Paper", "sections": ["intro", "methods", "results"] }`;

const TUPLE_PROMPT = `Return this exact JSON: { "value": "test", "probability": 0.75, "suggestions": ["Journal A", "Journal B", "Journal C"] }`;

// Create test agents
const basicAgent = new Agent({
  id: 'test-basic-agent',
  name: 'Test Basic Agent',
  instructions: 'You are a test agent. Return valid JSON only, no markdown.',
  model: geminiModel,
});

type TestResult = {
  name: string;
  status: 'PASS' | 'FAIL' | 'TIMEOUT';
  durationMs: number;
  error?: string;
  responseChars?: number;
};

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<{ responseChars: number }>
): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));

  const start = Date.now();
  try {
    const result = await withTimeout(testFn(), TIMEOUT_MS, name);
    const duration = Date.now() - start;
    console.log(`✅ PASS (${duration}ms, ${result.responseChars} chars)`);
    results.push({ name, status: 'PASS', durationMs: duration, responseChars: result.responseChars });
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes('TIMEOUT');
    console.log(`❌ ${isTimeout ? 'TIMEOUT' : 'FAIL'} (${duration}ms): ${message}`);
    results.push({
      name,
      status: isTimeout ? 'TIMEOUT' : 'FAIL',
      durationMs: duration,
      error: message,
    });
  }
}

async function main() {
  console.log('Starting paper workflow variant tests...');
  console.log(`Each test has a ${TIMEOUT_MS / 1000} second timeout.\n`);

  // ============================================================
  // TEST 1: .stream() + string prompt (CURRENT WORKING APPROACH)
  // ============================================================
  await runTest('1. stream() + string prompt', async () => {
    const response = await (basicAgent as any).stream([{ role: 'user', content: TEST_PROMPT }]);
    let raw = '';
    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
    }
    const parsed = complexSchema.safeParse(JSON.parse(raw.trim()));
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: raw.length };
  });

  // ============================================================
  // TEST 2: .stream() + message array with content parts
  // ============================================================
  await runTest('2. stream() + message array with contentParts', async () => {
    const response = await (basicAgent as any).stream([
      { role: 'user', content: [{ type: 'text', text: TEST_PROMPT }] },
    ]);
    let raw = '';
    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
    }
    const parsed = complexSchema.safeParse(JSON.parse(raw.trim()));
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: raw.length };
  });

  // ============================================================
  // TEST 3: .generate() + string prompt (NO structuredOutput)
  // ============================================================
  await runTest('3. generate() + string prompt (no structuredOutput)', async () => {
    const res = await basicAgent.generate(TEST_PROMPT);
    const text = (res as any).text || '';
    // Try to parse as JSON
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const json = JSON.parse(text.slice(start, end + 1));
      const parsed = complexSchema.safeParse(json);
      if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    }
    return { responseChars: text.length };
  });

  // ============================================================
  // TEST 4: .generate() + string prompt + SIMPLE schema
  // ============================================================
  await runTest('4. generate() + string prompt + simple schema', async () => {
    const res = await basicAgent.generate(SIMPLE_PROMPT, {
      structuredOutput: { schema: simpleSchema, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = simpleSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 5: .generate() + string prompt + MEDIUM schema
  // ============================================================
  await runTest('5. generate() + string prompt + medium schema', async () => {
    const res = await basicAgent.generate(MEDIUM_PROMPT, {
      structuredOutput: { schema: mediumSchema, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = mediumSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 6: .generate() + string prompt + COMPLEX schema (with defaults)
  // ============================================================
  await runTest('6. generate() + string prompt + complex schema (with .default())', async () => {
    const res = await basicAgent.generate(TEST_PROMPT, {
      structuredOutput: { schema: complexSchema, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 7: .generate() + string prompt + TUPLE schema
  // ============================================================
  await runTest('7. generate() + string prompt + tuple schema', async () => {
    const res = await basicAgent.generate(TUPLE_PROMPT, {
      structuredOutput: { schema: tupleSchema, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = tupleSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 8: .generate() + message array + simple schema
  // ============================================================
  await runTest('8. generate() + message array + simple schema', async () => {
    const res = await basicAgent.generate(
      [{ role: 'user', content: SIMPLE_PROMPT }],
      { structuredOutput: { schema: simpleSchema, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = simpleSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 9: .generate() + message array + complex schema
  // ============================================================
  await runTest('9. generate() + message array + complex schema', async () => {
    const res = await basicAgent.generate(
      [{ role: 'user', content: TEST_PROMPT }],
      { structuredOutput: { schema: complexSchema, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 10: .generate() + message array with contentParts + complex schema
  // ============================================================
  await runTest('10. generate() + message array with contentParts + complex schema', async () => {
    const res = await basicAgent.generate(
      [{ role: 'user', content: [{ type: 'text', text: TEST_PROMPT }] }],
      { structuredOutput: { schema: complexSchema, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 11: Complex schema WITHOUT .default() modifiers
  // ============================================================
  const complexSchemaNoDefaults = z.object({
    selectedJournal: z.string(),
    paperTitleCandidates: z.array(z.string()),
    outline: z.array(z.object({
      sectionId: z.string(),
      bullets: z.array(z.string()),
    })),
    figurePlan: z.array(z.object({
      figureId: z.string(),
      imageUrl: z.string(),
      caption: z.string(),
      sectionId: z.string(),
    })),
  });

  await runTest('11. generate() + string prompt + complex schema (NO .default())', async () => {
    const res = await basicAgent.generate(TEST_PROMPT, {
      structuredOutput: { schema: complexSchemaNoDefaults, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = complexSchemaNoDefaults.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 12: Complex schema with .url() validator
  // ============================================================
  const complexSchemaWithUrl = z.object({
    selectedJournal: z.string(),
    figurePlan: z.array(z.object({
      figureId: z.string(),
      imageUrl: z.string().url(),  // URL validator
      caption: z.string(),
    })),
  });

  const URL_PROMPT = `Return this exact JSON: { "selectedJournal": "Test", "figurePlan": [{ "figureId": "fig1", "imageUrl": "https://example.com/image.png", "caption": "Test caption" }] }`;

  await runTest('12. generate() + string prompt + schema with .url() validator', async () => {
    const res = await basicAgent.generate(URL_PROMPT, {
      structuredOutput: { schema: complexSchemaWithUrl, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = complexSchemaWithUrl.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 13: Large prompt (simulating real workflow)
  // ============================================================
  const LARGE_PROMPT = `You are a test agent. Here is a lot of context:

${'Lorem ipsum dolor sit amet. '.repeat(500)}

Now return this JSON:
{ "selectedJournal": "Test Journal", "paperTitleCandidates": ["Title"], "outline": [{ "sectionId": "intro", "bullets": ["Point 1"] }], "figurePlan": [] }

Return ONLY the JSON.`;

  await runTest('13. generate() + LARGE prompt (~15k chars) + complex schema', async () => {
    const res = await basicAgent.generate(LARGE_PROMPT, {
      structuredOutput: { schema: complexSchema, errorStrategy: 'strict' },
    } as any);
    const obj = (res as any)?.object;
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 14: .stream() + message array with images + complex schema
  // ============================================================
  const IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png';

  await runTest('14. stream() + message array with image + complex schema', async () => {
    const response = await (basicAgent as any).stream([
      {
        role: 'user',
        content: [
          { type: 'image', image: IMAGE_URL, mimeType: 'image/png' },
          { type: 'text', text: TEST_PROMPT },
        ],
      },
    ]);
    let raw = '';
    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
    }
    // Parse defensively
    const trimmed = raw.trim();
    let obj: unknown = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      }
    }
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: raw.length };
  });

  // ============================================================
  // TEST 15: .stream() + LARGE prompt + message array with images + complex schema
  // ============================================================
  const LARGE_PROMPT_WITH_CONTEXT = `You are a test agent. Here is a lot of research context:

${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(300)}

REFINED IDEA:
${'This is a research idea about machine learning and data analysis. '.repeat(50)}

DESIGN PLAN:
${'The experiment will use a neural network architecture. '.repeat(50)}

EXPERIMENT CODE:
\`\`\`python
${'# This is some experiment code\nimport numpy as np\n'.repeat(20)}
\`\`\`

RESULTS:
${'Accuracy: 0.95, Loss: 0.05, Epoch: 100. '.repeat(30)}

Now based on all this context, return a JSON paper plan:
{ "selectedJournal": "Nature ML", "paperTitleCandidates": ["Title 1", "Title 2"], "outline": [{ "sectionId": "intro", "bullets": ["Point 1", "Point 2"] }], "figurePlan": [] }

Return ONLY the JSON, no markdown or explanation.`;

  await runTest('15. stream() + LARGE prompt (~30k chars) + message array with image + complex schema', async () => {
    const response = await (basicAgent as any).stream([
      {
        role: 'user',
        content: [
          { type: 'image', image: IMAGE_URL, mimeType: 'image/png' },
          { type: 'text', text: LARGE_PROMPT_WITH_CONTEXT },
        ],
      },
    ]);
    let raw = '';
    let chunkCount = 0;
    for await (const chunk of response.textStream as AsyncIterable<string>) {
      raw += chunk;
      chunkCount++;
    }
    console.log(`    (received ${chunkCount} chunks, ${raw.length} chars)`);
    // Parse defensively
    const trimmed = raw.trim();
    let obj: unknown = null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      }
    }
    const parsed = complexSchema.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: raw.length };
  });

  // ============================================================
  // TEST 16: .generate() + complex schema with .default() REMOVED (control test)
  // ============================================================
  await runTest('16. generate() + message array + complex schema (NO .default())', async () => {
    const res = await basicAgent.generate(
      [{ role: 'user', content: TEST_PROMPT }],
      { structuredOutput: { schema: complexSchemaNoDefaults, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = complexSchemaNoDefaults.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 17: .generate() with ONLY the .default() arrays (isolate the issue)
  // ============================================================
  const schemaWithOnlyDefaults = z.object({
    items: z.array(z.string()).default([]),
  });

  await runTest('17. generate() + schema with ONLY array.default([])', async () => {
    const res = await basicAgent.generate(
      'Return JSON: { "items": ["a", "b", "c"] }',
      { structuredOutput: { schema: schemaWithOnlyDefaults, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = schemaWithOnlyDefaults.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 18: .generate() with nested array WITHOUT .default()
  // ============================================================
  const schemaNestedNoDefault = z.object({
    sections: z.array(z.object({
      id: z.string(),
      items: z.array(z.string()),
    })),
  });

  await runTest('18. generate() + nested array schema (NO .default())', async () => {
    const res = await basicAgent.generate(
      'Return JSON: { "sections": [{ "id": "sec1", "items": ["item1", "item2"] }] }',
      { structuredOutput: { schema: schemaNestedNoDefault, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = schemaNestedNoDefault.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 19: .generate() with nested array WITH .default() on inner array
  // ============================================================
  const schemaNestedWithDefault = z.object({
    sections: z.array(z.object({
      id: z.string(),
      items: z.array(z.string()).default([]),  // <-- .default() on inner array
    })),
  });

  await runTest('19. generate() + nested array schema (WITH .default() on inner)', async () => {
    const res = await basicAgent.generate(
      'Return JSON: { "sections": [{ "id": "sec1", "items": ["item1", "item2"] }] }',
      { structuredOutput: { schema: schemaNestedWithDefault, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = schemaNestedWithDefault.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // TEST 20: .generate() with .default() on OUTER array only
  // ============================================================
  const schemaOuterDefault = z.object({
    sections: z.array(z.object({
      id: z.string(),
      items: z.array(z.string()),
    })).default([]),  // <-- .default() on outer array
  });

  await runTest('20. generate() + nested array schema (WITH .default() on outer)', async () => {
    const res = await basicAgent.generate(
      'Return JSON: { "sections": [{ "id": "sec1", "items": ["item1", "item2"] }] }',
      { structuredOutput: { schema: schemaOuterDefault, errorStrategy: 'strict' } } as any
    );
    const obj = (res as any)?.object;
    const parsed = schemaOuterDefault.safeParse(obj);
    if (!parsed.success) throw new Error('Schema validation failed: ' + parsed.error.message);
    return { responseChars: JSON.stringify(obj).length };
  });

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.status === 'PASS');
  const failed = results.filter((r) => r.status === 'FAIL');
  const timeout = results.filter((r) => r.status === 'TIMEOUT');

  console.log(`\nTotal: ${results.length} | ✅ Passed: ${passed.length} | ❌ Failed: ${failed.length} | ⏱️ Timeout: ${timeout.length}\n`);

  console.log('Results by test:');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'TIMEOUT' ? '⏱️' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.status} (${r.durationMs}ms)`);
  }

  if (timeout.length > 0) {
    console.log('\n⏱️ TIMEOUT tests (these hang with Vertex AI/Gemini):');
    for (const r of timeout) {
      console.log(`  - ${r.name}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ FAILED tests:');
    for (const r of failed) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('CONCLUSION');
  console.log('='.repeat(60));

  // Analyze patterns
  const streamTests = results.filter((r) => r.name.includes('stream()'));
  const generateTests = results.filter((r) => r.name.includes('generate()'));
  const messageArrayTests = results.filter((r) => r.name.includes('message array'));
  const complexSchemaTests = results.filter((r) => r.name.includes('complex schema'));

  console.log(`\nstream() tests: ${streamTests.filter((r) => r.status === 'PASS').length}/${streamTests.length} passed`);
  console.log(`generate() tests: ${generateTests.filter((r) => r.status === 'PASS').length}/${generateTests.length} passed`);
  console.log(`message array tests: ${messageArrayTests.filter((r) => r.status === 'PASS').length}/${messageArrayTests.length} passed`);
  console.log(`complex schema tests: ${complexSchemaTests.filter((r) => r.status === 'PASS').length}/${complexSchemaTests.length} passed`);
}

main().catch(console.error);
