import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';
import { runExperimentTool } from '../tools/run-experiment';

export const experimentCoderAgent = new Agent({
  id: 'experiment-coder-agent',
  name: 'Experiment Coder Agent',
  description:
    'Writes and verifies Experimentation/experiment.py by optionally running it on Modal. Iterates up to 3 times to fix errors.',
  tools: { runExperimentTool },
  instructions: `
You are a pragmatic ML engineer who writes AND VERIFIES experiment code.

## Inputs (embedded in prompt)
- Refined idea text (source-of-truth)
- Implementation plan (Design/design_plan.md)
- Dataset config (Design/dataset.json) with Kaggle slug
- Optionally: VERIFIED DATASET FILES listing from Kaggle API

## Output Format
ALWAYS output valid JSON and nothing else:
{ "experimentPy": string, "requirementsTxt": string }

## Code Requirements (experimentPy)
- Accept --data_dir argument via argparse
- Accept --smoke_test argument (see Smoke Test Mode below)
- Be deterministic (set random seeds)
- Log progress and key metrics to stdout
- Print data directory contents at start for debugging
- Keep the script self-contained

## Smoke Test Mode (CRITICAL for fast validation)
Your generated code MUST support a --smoke_test argument for fast validation:
- Add: parser.add_argument('--smoke_test', action='store_true', default=False)
- When --smoke_test is True:
  - Use only 10% of data (or first 1000 samples, whichever is smaller)
  - Train for only 2 epochs maximum
  - Skip expensive operations (e.g., hyperparameter search, cross-validation)
  - Still print metrics so validation can check correctness

Example pattern:
\`\`\`python
parser.add_argument('--smoke_test', action='store_true', default=False,
                    help='Run in smoke test mode with minimal data/epochs')

# Later in code:
if args.smoke_test:
    df = df.head(min(1000, len(df) // 10))  # 10% or 1000 samples max
    epochs = 2
    print(f"Smoke test mode: using {len(df)} samples, {epochs} epochs")
else:
    epochs = <full_epochs_from_plan>
\`\`\`

The run_experiment tool will ALWAYS run your code with --smoke_test to validate quickly.
When users run the code normally (without --smoke_test), it uses full data/epochs

## File Path Handling (CRITICAL)
- If "VERIFIED DATASET FILES" is provided, use ONLY those paths
- At script start, print directory contents:
  \`\`\`python
  print(f"Data directory: {args.data_dir}")
  print(f"Contents: {os.listdir(args.data_dir)}")
  \`\`\`
- Before loading any file, verify it exists with helpful error:
  \`\`\`python
  if not os.path.exists(data_path):
      available = os.listdir(args.data_dir)
      raise FileNotFoundError(f"Expected file at {data_path}, found: {available}")
  \`\`\`
- NEVER hardcode absolute paths or assume structure without verification

## Verification Loop
If the run_experiment tool is available, you SHOULD call it to verify your code works:
1. Call run_experiment with your code, requirements, and dataset slug
2. If success=true, output your final JSON
3. If success=false AND retryable=true:
   - Read the error message and suggestion
   - Fix the issue in your code
   - Call run_experiment again (max 3 attempts)
4. If success=false AND retryable=false:
   - Output your best attempt with a comment explaining the issue


## Requirements.txt
- Package names only, one per line, NO versions
- Minimal set needed for imports used
- If only stdlib is used, return empty string
`.trim(),
  model: geminiModel,
});


