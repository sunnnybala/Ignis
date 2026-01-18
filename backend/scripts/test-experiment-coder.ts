/**
 * Test script for experimentCoderAgent with run_experiment tool
 *
 * This script:
 * 1. Sets up mock VFS with test files
 * 2. Calls experimentCoderAgent directly
 * 3. Logs all tool calls, inputs, outputs, and agent reactions
 * 4. Verifies the agent correctly uses the run_experiment tool
 *
 * Run with: npx tsx --env-file=.env scripts/test-experiment-coder.ts
 *       or: npx tsx -r dotenv/config scripts/test-experiment-coder.ts
 */

// Verify critical env vars are loaded (should be set via --env-file or -r dotenv/config)
console.log('[ENV CHECK]');
console.log(`  GOOGLE_VERTEX_PROJECT: ${process.env.GOOGLE_VERTEX_PROJECT ? 'SET' : 'NOT SET'}`);
console.log(`  GOOGLE_CLIENT_EMAIL: ${process.env.GOOGLE_CLIENT_EMAIL ? 'SET' : 'NOT SET'}`);
console.log(`  GOOGLE_PRIVATE_KEY: ${process.env.GOOGLE_PRIVATE_KEY ? 'SET (length: ' + process.env.GOOGLE_PRIVATE_KEY.length + ')' : 'NOT SET'}`);
console.log(`  MODAL_RUNNER_SYNC_URL: ${process.env.MODAL_RUNNER_SYNC_URL ? 'SET' : 'NOT SET'}`);
console.log('');

// Import modules (env vars should already be loaded by Node)
import { experimentCoderAgent } from '../src/mastra/agents/experiment-coder-agent';

// Test configuration
const TEST_TRACE_ID = `test-${Date.now()}`;
const TEST_PROJECT_ID = 'test-project-001';

// Sample refined idea for testing
const REFINED_IDEA = `# Refined Research Idea

## Title
Sentiment Analysis on Movie Reviews using Logistic Regression

## Objective
Build a baseline sentiment classifier for the IMDB movie reviews dataset.

## Methodology
- Use TF-IDF vectorization for text feature extraction
- Train a Logistic Regression classifier
- Evaluate with accuracy, precision, recall, F1-score

## Expected Outcome
Achieve >80% test accuracy.
`;

// Sample design plan
const DESIGN_PLAN = `# Implementation Plan

## Overview
Simple sentiment classification pipeline using scikit-learn.

## Steps
1. Load IMDB dataset from CSV
2. Preprocess text (lowercase, remove punctuation)
3. TF-IDF vectorization
4. Train Logistic Regression
5. Evaluate and save metrics

## Model Architecture
- TF-IDF with max_features=5000
- Logistic Regression with default parameters

## Evaluation
- Train/test split: 80/20
- Metrics: accuracy, precision, recall, F1
`;

// Sample dataset config with verified files
const DATASET_CONFIG = {
  source: 'kaggle',
  kaggle: {
    dataset: 'lakshmi25npathi/imdb-dataset-of-50k-movie-reviews',
    unzip: true,
    files: ['IMDB Dataset.csv'],
    verifiedAt: new Date().toISOString(),
    totalSizeBytes: 66000000,
  },
  layout: {
    subdir: '',
    dataPattern: 'flat',
  },
  notes: 'Single CSV file with review and sentiment columns',
};

// Build the prompt that would be sent to the agent
function buildPrompt(): string {
  const fileListingBlock = DATASET_CONFIG.kaggle.files
    ? `
VERIFIED DATASET FILES:
${DATASET_CONFIG.kaggle.files.map((f) => `  - ${f}`).join('\n')}

IMPORTANT: Use ONLY these exact file paths. Do NOT guess other paths.
`
    : '';

  return `
You are generating experiment code for the following research idea.

REFINED IDEA (source of truth):
${REFINED_IDEA}

DESIGN PLAN (from Design/design_plan.md):
${DESIGN_PLAN}

DATASET CONFIG (from Design/dataset.json):
${JSON.stringify(DATASET_CONFIG, null, 2)}
${fileListingBlock}

Important: requirements.txt must list ONLY package names, one per line, with NO version specifiers.

Generate the experiment code and requirements, then use the run_experiment tool to verify it works.
`.trim();
}

async function main() {
  console.log('='.repeat(70));
  console.log('EXPERIMENT CODER AGENT TEST');
  console.log('='.repeat(70));
  console.log(`Trace ID: ${TEST_TRACE_ID}`);
  console.log(`Project ID: ${TEST_PROJECT_ID}`);
  console.log(`MODAL_RUNNER_SYNC_URL: ${process.env.MODAL_RUNNER_SYNC_URL || '(not set)'}`);
  console.log('='.repeat(70));

  if (!process.env.MODAL_RUNNER_SYNC_URL) {
    console.log('\n[WARNING] MODAL_RUNNER_SYNC_URL is not set!');
    console.log('The run_experiment tool will return an error about missing configuration.');
    console.log('Set this in .env to test actual Modal execution.\n');
  }

  const prompt = buildPrompt();
  console.log('\n[INPUT PROMPT]');
  console.log('-'.repeat(70));
  console.log(prompt.slice(0, 1500) + (prompt.length > 1500 ? '\n...(truncated)' : ''));
  console.log('-'.repeat(70));

  console.log('\n[STARTING AGENT EXECUTION]');
  console.log('Calling experimentCoderAgent.generate()...\n');

  const startTime = Date.now();

  try {
    // Create a mock request context
    const mockRequestContext = {
      get: (key: string) => {
        if (key === 'traceId') return TEST_TRACE_ID;
        if (key === 'projectId') return TEST_PROJECT_ID;
        if (key === 'userId') return 'test-user';
        return undefined;
      },
    };

    // Call the agent with structured output
    const result = await experimentCoderAgent.generate(
      [
        {
          role: 'user',
          content: prompt,
        },
      ],
      {
        output: {
          experimentPy: {
            type: 'string',
            description: 'The Python experiment code',
          },
          requirementsTxt: {
            type: 'string',
            description: 'Package requirements (one per line, no versions)',
          },
        },
        requestContext: mockRequestContext as any,
      }
    );

    const elapsed = Date.now() - startTime;

    console.log('\n' + '='.repeat(70));
    console.log('[AGENT EXECUTION COMPLETE]');
    console.log('='.repeat(70));
    console.log(`Elapsed time: ${elapsed}ms`);

    // Log the result structure
    console.log('\n[RESULT STRUCTURE]');
    console.log(`- Has text: ${!!result.text}`);
    console.log(`- Has object: ${!!result.object}`);
    console.log(`- Has toolResults: ${!!result.toolResults}`);
    console.log(`- Tool results count: ${result.toolResults?.length || 0}`);

    // Log tool calls if any
    if (result.toolResults && result.toolResults.length > 0) {
      console.log('\n[TOOL CALLS]');
      console.log('-'.repeat(70));
      for (let i = 0; i < result.toolResults.length; i++) {
        const toolResult = result.toolResults[i] as any;
        // Mastra wraps tool results in a payload object
        const payload = toolResult.payload || toolResult;
        console.log(`\nTool Call #${i + 1}:`);
        console.log(`  Tool: ${payload.toolName || '(unknown)'}`);
        try {
          const argsStr = JSON.stringify(payload.args || {}, null, 2);
          console.log(`  Args: ${argsStr.slice(0, 500)}${argsStr.length > 500 ? '...' : ''}`);
        } catch {
          console.log(`  Args: (could not serialize)`);
        }
        try {
          const resultStr = JSON.stringify(payload.result || {}, null, 2);
          console.log(`  Result: ${resultStr.slice(0, 1000)}${resultStr.length > 1000 ? '...' : ''}`);
        } catch {
          console.log(`  Result: (could not serialize)`);
        }
      }
    } else {
      console.log('\n[NO TOOL CALLS DETECTED]');
      console.log('The agent did not call the run_experiment tool.');
    }

    // Log the generated code
    if (result.object) {
      const obj = result.object as { experimentPy?: string; requirementsTxt?: string };

      console.log('\n[GENERATED OUTPUT]');
      console.log('-'.repeat(70));

      if (obj.experimentPy) {
        console.log('\nexperiment.py (first 2000 chars):');
        console.log(obj.experimentPy.slice(0, 2000));
        if (obj.experimentPy.length > 2000) {
          console.log(`\n...(${obj.experimentPy.length - 2000} more chars)`);
        }
      }

      if (obj.requirementsTxt) {
        console.log('\nrequirements.txt:');
        console.log(obj.requirementsTxt);
      }
    }

    // Log any text response
    if (result.text) {
      console.log('\n[AGENT TEXT RESPONSE]');
      console.log('-'.repeat(70));
      console.log(result.text.slice(0, 2000));
      if (result.text.length > 2000) {
        console.log(`\n...(${result.text.length - 2000} more chars)`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('[TEST COMPLETE]');
    console.log('='.repeat(70));

    // Summary
    console.log('\n[SUMMARY]');
    const toolCalled = result.toolResults && result.toolResults.length > 0;
    // Mastra wraps tool results in a payload object: { type: 'tool-result', payload: { toolName, args, result } }
    // Tool name can be 'run_experiment' (tool ID) or 'runExperimentTool' (variable name)
    const runExpToolCalled = result.toolResults?.some((t: any) => {
      const payload = t.payload || t;
      const toolName = payload.toolName || '';
      return toolName === 'run_experiment' || toolName === 'runExperimentTool';
    });

    // Check for output in result.object OR parse from result.text (agent may return JSON in text)
    let obj = result.object as { experimentPy?: string; requirementsTxt?: string } | undefined;
    if (!obj && result.text) {
      // Try to extract JSON from text response (may be wrapped in ```json ... ```)
      const jsonMatch = result.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          obj = JSON.parse(jsonMatch[1]);
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Check if smoke_test is in the generated code
    const hasSmokeTest = obj?.experimentPy?.includes('--smoke_test') || obj?.experimentPy?.includes('smoke_test');

    console.log(`- Agent called any tool: ${toolCalled ? 'YES' : 'NO'}`);
    console.log(`- Agent called run_experiment: ${runExpToolCalled ? 'YES' : 'NO'}`);
    console.log(`- Generated experimentPy: ${obj?.experimentPy ? 'YES' : 'NO'}`);
    console.log(`- Generated requirementsTxt: ${obj?.requirementsTxt !== undefined ? 'YES' : 'NO'}`);
    console.log(`- Code has --smoke_test support: ${hasSmokeTest ? 'YES' : 'NO'}`);
  } catch (error) {
    console.error('\n[ERROR]');
    console.error('-'.repeat(70));
    console.error(error);
  }
}

main().catch(console.error);
