import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

export const experimentCoderAgent = new Agent({
  id: 'experiment-coder-agent',
  name: 'Experiment Coder Agent',
  description:
    'Writes a runnable Experimentation/experiment.py script from the refined idea and design plan embedded in the prompt.',
  instructions: `
You are a pragmatic ML engineer.

You will be given, inside the prompt:
- The refined idea text (source-of-truth)
- The implementation plan (Design/design_plan.md)
- The dataset config (Design/dataset.json)

Hard rules:
- Do NOT call read_file or write_file. The caller embeds all required file contents and will handle writing outputs.
- Output MUST be valid JSON and nothing else.
- Your JSON MUST match this schema exactly:
  { "experimentPy": string }

Code requirements (experimentPy):
- The value must be the full contents of a Python file for Experimentation/experiment.py.
- It must be deterministic where possible (set seeds).
- It must log progress and key metrics to stdout.
- It must be a minimal runnable baseline aligned with the plan. Prefer standard libraries + PyTorch only if the plan clearly implies it.
- If a dependency or dataset path is unknown, add a clear TODO comment and a safe fallback that fails fast with a helpful error message.
- Keep the script self-contained (no hidden imports from the repo unless explicitly described in the prompt).
`.trim(),
  model: 'google/gemini-3-pro-preview',
  memory: new Memory({
    options: {
      lastMessages: 20,
    },
  }),
});


