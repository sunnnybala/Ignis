import { Router } from 'express';
import { RequestContext } from '@mastra/core/request-context';

import { mastra } from '../mastra';
import { getAuthedUser, getOwnedProject, logAuthzDenied } from '../authz/ownership';

export const vfsRouter = Router();

// POST /vfs/:projectId/chat  { message }
// Simple test endpoint to exercise read_file/write_file tools via vfsAgent.
vfsRouter.post('/:projectId/chat', async (req, res) => {
  try {
    // const user = getAuthedUser(req);
    // if (!user) return res.status(401).json({ error: 'Unauthorized' });

    // const projectId = String(req.params.projectId);
    // const owned = await getOwnedProject(projectId, user.id);
    // if (!owned) {
    //   logAuthzDenied(req, { projectId });
    //   return res.status(404).json({ error: 'Project not found' });
    // }
    const userId = "123";
    const projectId = "123";
    const message = String(req.body?.message ?? '').trim();
    // if (!message) return res.status(400).json({ error: 'message is required' });

    const requestContext = new RequestContext<{ userId: string; projectId: string; userinstructions: string }>();
    let userinstructions = "search for blogs relating to paul graham essays,call any tool only once"
    requestContext.set('userId', userId);
    requestContext.set('projectId', projectId);
    requestContext.set('userinstructions', userinstructions);
    const agent = mastra.getAgent('vfsAgent');
    const result = await agent.generate(message, { requestContext });

    
    let debug = true;
    if (debug) {
      return res.status(200).json({
        text: result.text.slice(0, 100),
        //traceId: result.traceId ?? null,
        //usage: result.usage ?? null,
        //finishReason: result.finishReason ?? null,
        toolCalls: result.toolCalls ?? [],
        toolResults: result.toolResults ?? [],
        // steps: result.steps ?? [],
        //warnings: result.warnings ?? [],
        //providerMetadata: result.providerMetadata ?? null,
      });
    }

    return res.status(200).json({ text: result.text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed';
    return res.status(500).json({ error: message });
  }
});


