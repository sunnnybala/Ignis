import { Agent } from '@mastra/core/agent';

import { geminiModel } from '../model';
import { readFileTool } from '../tools/read-file';
import { writeFileTool } from '../tools/write-file';
import { webSearchTool } from '../tools/web-search';
import { searchPapersTool } from '../tools/search-papers';

export const vfsAgent = new Agent({
  id: 'vfs-agent',
  name: 'VFS Agent',
  description: 'Reads and writes text files in the project virtual filesystem (DB-backed).',
  instructions: ({ requestContext }) => {
    const extra = String(requestContext.get('userinstructions') ?? '').trim();
    return `
You are a utility agent that helps the user with file operations, web search, and paper search.

Rules:
- Use read_file to read file contents by path.
- Use write_file to create/update files by path.
- Use web_search to search the web for information.
- Use search_papers to search for papers.
- The server provides userId and projectId via request context; never ask for them.
- Only work with text files. If a file appears to be binary (pdf/image), explain you cannot read it as text.

${extra ? `User instructions (testing):\n${extra}` : ''}
`.trim();
  },
  model: geminiModel,
  tools: { readFileTool, writeFileTool, webSearchTool, searchPapersTool },
});


