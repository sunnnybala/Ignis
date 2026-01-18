/**
 * Test script for kaggleDatasetInfoTool
 *
 * Run with: npx tsx --env-file=.env scripts/test-kaggle-tool.ts
 *       or: npx tsx -r dotenv/config scripts/test-kaggle-tool.ts
 */

// Check env vars first
console.log('[ENV CHECK]');
console.log(`  KAGGLE_USERNAME: ${process.env.KAGGLE_USERNAME ? 'SET' : 'NOT SET'}`);
console.log(`  KAGGLE_KEY: ${process.env.KAGGLE_KEY ? 'SET (length: ' + process.env.KAGGLE_KEY.length + ')' : 'NOT SET'}`);
console.log('');

import { kaggleDatasetInfoTool } from '../src/mastra/tools/kaggle-dataset-info';

// Test datasets
const TEST_SLUGS = [
  'lakshmi25npathi/imdb-dataset-of-50k-movie-reviews', // IMDB reviews - should exist
  'gazu468/cifar10-classification-image',              // CIFAR-10 images
  'invalid/nonexistent-dataset-12345',                 // Should return exists=false
];

async function main() {
  console.log('='.repeat(70));
  console.log('KAGGLE DATASET INFO TOOL TEST');
  console.log('='.repeat(70));

  for (const slug of TEST_SLUGS) {
    console.log(`\n[TESTING] ${slug}`);
    console.log('-'.repeat(70));

    try {
      const startTime = Date.now();
      const result = await kaggleDatasetInfoTool.execute({ slug }, {} as any);
      const elapsed = Date.now() - startTime;

      console.log(`Duration: ${elapsed}ms`);
      console.log(`Result:`);
      console.log(JSON.stringify(result, null, 2));

      if (result.exists && result.accessible && result.files) {
        console.log(`\nFiles found: ${result.files.length}`);
        result.files.slice(0, 5).forEach((f) => {
          console.log(`  - ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)`);
        });
        if (result.files.length > 5) {
          console.log(`  ... and ${result.files.length - 5} more files`);
        }
      }
    } catch (error) {
      console.error(`ERROR: ${error}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('[TEST COMPLETE]');
  console.log('='.repeat(70));
}

main().catch(console.error);
