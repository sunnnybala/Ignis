import crypto from 'node:crypto';
import { Router } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { RequestContext } from '@mastra/core/request-context';

import { db } from '../db/client';
import { files } from '../db/schema';
import { initSse } from '../utils/sse';
import { getAuthedUser, getOwnedProject, logAuthzDenied } from '../authz/ownership';
import { logger } from '../utils/logger';

import { mastra } from '../mastra';
import { type RouterPrimitiveId, type RouterStatus } from '../mastra/agents/ignis-router-agent';

export const routerRouter = Router();

const PATHS = {
  research: {
    litReview: 'Research/lit_review.md',
    novelty: 'Research/novelty_assessment.md',
    refinedIdea: 'Research/refined_idea.md',
  },
  impl: {
    designPlan: 'Design/design_plan.md',
    dataset: 'Design/dataset.json',
    experiment: 'Experimentation/experiment.py',
  },
  paper: {
    tex: 'Final_Paper/paper.tex',
    meta: 'Final_Paper/paper_metadata.json'
  },
} as const;

const OVERWRITE_PATHS: RouterStatus['overwritePathsByWorkflow'] = {
  noveltyRefineWorkflow: [PATHS.research.litReview, PATHS.research.novelty, PATHS.research.refinedIdea],
  planImplementWorkflow: [PATHS.impl.designPlan, PATHS.impl.dataset, PATHS.impl.experiment],
  paperPlanWriteWorkflow: [PATHS.paper.tex, PATHS.paper.meta],
};

function isNonEmptyText(s: unknown): boolean {
  return String(s ?? '').trim().length > 0;
}

function parseConfirmOverwrite(latestMessage: string): RouterPrimitiveId | null {
  const m = /^\s*CONFIRM\s+OVERWRITE\s+(noveltyRefineWorkflow|planImplementWorkflow|paperPlanWriteWorkflow)\s*$/i.exec(
    latestMessage || '',
  );
  if (!m) return null;
  const id = m[1] as RouterPrimitiveId;
  if (id === 'noveltyRefineWorkflow' || id === 'planImplementWorkflow' || id === 'paperPlanWriteWorkflow') return id;
  return null;
}

async function computeNonEmptyByPath(projectId: string, paths: string[]) {
  const rows = await db
    .select({ path: files.path, content: files.content })
    .from(files)
    .where(and(eq(files.projectId, projectId), inArray(files.path, paths)));

  const map: Record<string, boolean> = {};
  for (const p of paths) map[p] = false;
  for (const row of rows) {
    map[String(row.path)] = isNonEmptyText(row.content);
  }
  return map;
}

function computeAllowedPrimitives(args: {
  filesNonEmpty: Record<string, boolean>;
  confirmedOverwriteWorkflowId: RouterPrimitiveId | null;
}): RouterPrimitiveId[] {
  const ne = (p: string) => Boolean(args.filesNonEmpty[p]);

  const researchHasRunOnce =
    ne(PATHS.research.litReview) || ne(PATHS.research.novelty) || ne(PATHS.research.refinedIdea);
  const implementationHasRunOnce = ne(PATHS.impl.designPlan) || ne(PATHS.impl.dataset) || ne(PATHS.impl.experiment);
  const paperHasRunOnce = ne(PATHS.paper.tex)

  const researchFilesReady = ne(PATHS.research.litReview) && ne(PATHS.research.novelty) && ne(PATHS.research.refinedIdea);
  const implFilesReady = ne(PATHS.impl.designPlan) && ne(PATHS.impl.dataset) && ne(PATHS.impl.experiment);
  const paperFilesReady = ne(PATHS.paper.tex)

  // If the user sent an explicit confirmation, allow ONLY that workflow (and rely on workflow itself for correctness).
  if (args.confirmedOverwriteWorkflowId) {
    const id = args.confirmedOverwriteWorkflowId;
    // Still enforce phase gates for implementation/paper resets.
    if (id === 'planImplementWorkflow' && !researchFilesReady) return [];
    if (id === 'paperPlanWriteWorkflow' && !implFilesReady) return [];
    return [id];
  }

  // Base gating by phase readiness.
  const allowed: RouterPrimitiveId[] = [];

  // Research workflow should be available whenever research hasn't produced complete outputs yet,
  // as long as we're not in later phases with valid artifacts (follow-up agents handle edits).
  if (!researchFilesReady) {
    allowed.push('noveltyRefineWorkflow');
    if (researchHasRunOnce) allowed.push('researchAgent');
    return allowed;
  }

  // Research is complete; allow follow-up edits.
  allowed.push('researchAgent');

  // Implementation gating
  if (!implFilesReady) {
    // If implementation hasn't run once, allow workflow to create baseline artifacts.
    allowed.push('planImplementWorkflow');
    if (implementationHasRunOnce) allowed.push('planImplementAgent');
    return allowed;
  }

  // Implementation complete; allow follow-up edits.
  allowed.push('planImplementAgent');

  // Paper gating
  if (!paperFilesReady) {
    allowed.push('paperPlanWriteWorkflow');
    return allowed;
  }

  // Paper exists; allow follow-up edits.
  allowed.push('paperWritingAgent');
  return allowed;
}

// POST /router/:projectId/chat  { message, history? }  -> SSE
routerRouter.post('/:projectId/chat', async (req, res) => {
  const sse = initSse(res);
  const traceId = crypto.randomUUID();

  try {
    const user = getAuthedUser(req);
    if (!user) {
      sse.write({ type: 'error', message: 'Unauthorized' });
      return sse.close();
    }

    const projectId = String(req.params.projectId);
    const owned = await getOwnedProject(projectId, user.id);
    if (!owned) {
      logAuthzDenied(req, { projectId });
      sse.write({ type: 'error', message: 'Project not found' });
      return sse.close();
    }

    const latestMessage = typeof req.body?.message === 'string' ? String(req.body.message).trim() : '';

    // Compute non-empty status (files assumed to exist; missing rows treated as empty).
    const keyPaths = [
      PATHS.research.litReview,
      PATHS.research.novelty,
      PATHS.research.refinedIdea,
      PATHS.impl.designPlan,
      PATHS.impl.dataset,
      PATHS.impl.experiment,
      PATHS.paper.tex,
      PATHS.paper.meta
    ];
    const filesNonEmpty = await computeNonEmptyByPath(projectId, keyPaths);

    const confirmedOverwriteWorkflowId = parseConfirmOverwrite(latestMessage);
    const allowedPrimitiveIds = computeAllowedPrimitives({ filesNonEmpty, confirmedOverwriteWorkflowId });

    const researchFilesReady =
      filesNonEmpty[PATHS.research.litReview] &&
      filesNonEmpty[PATHS.research.novelty] &&
      filesNonEmpty[PATHS.research.refinedIdea];
    const implFilesReady =
      filesNonEmpty[PATHS.impl.designPlan] && filesNonEmpty[PATHS.impl.dataset] && filesNonEmpty[PATHS.impl.experiment];
    const paperFilesReady = filesNonEmpty[PATHS.paper.tex];

    const researchHasRunOnce =
      filesNonEmpty[PATHS.research.litReview] ||
      filesNonEmpty[PATHS.research.novelty] ||
      filesNonEmpty[PATHS.research.refinedIdea];
    const implementationHasRunOnce =
      filesNonEmpty[PATHS.impl.designPlan] || filesNonEmpty[PATHS.impl.dataset] || filesNonEmpty[PATHS.impl.experiment];
    const paperHasRunOnce = paperFilesReady;

    const routerStatus: RouterStatus = {
      files: filesNonEmpty,
      booleans: {
        research_files_ready: researchFilesReady,
        implementation_files_ready: implFilesReady,
        paper_files_ready: paperFilesReady,
        research_workflow_has_run_once: researchHasRunOnce,
        implementation_workflow_has_run_once: implementationHasRunOnce,
        paper_workflow_has_run_once: paperHasRunOnce,
      },
      allowedPrimitiveIds,
      overwritePathsByWorkflow: OVERWRITE_PATHS,
    };

    const requestContext = new RequestContext<any>();
    requestContext.set('userId', user.id);
    requestContext.set('projectId', projectId);
    requestContext.set('routerStatus', routerStatus);
    requestContext.set('traceId', traceId);

    logger.info('router.chat.start', {
      traceId,
      projectId,
      userId: user.id,
      allowedPrimitives: allowedPrimitiveIds,
      hasMessage: !!latestMessage,
    });

    // Build messages for the network call.
    const messages: any[] = latestMessage ? [{ role: 'user', content: latestMessage }] : [];

    // Use the registered router agent so memory is consistently wired through the Mastra instance.
    const routingAgent = mastra.getAgent('ignisRouterAgent');

    // Execute the network. We pass:
    // - memory scope (resource=userId, thread=projectId) for conversation history
    // - requestContext for tool/workflow scoping (userId/projectId) used throughout this repo
    const networkRun = await (routingAgent as any).network(messages, {
      memory: { resource: user.id, thread: projectId },
      requestContext,
    });

    logger.debug('router.network.started', { traceId, projectId });

    // We don't rely on streaming semantics across beta versions; prefer the final result text.
    // If a stream is available, we still forward text deltas best-effort.
    let finalText: string | null = null;

    const iterable =
      (networkRun as any)?.[Symbol.asyncIterator] ? (networkRun as any) : (networkRun as any)?.stream ?? null;

    if (iterable) {
      for await (const chunk of iterable) {
        const type = String((chunk as any)?.type ?? '');
        if (!type) continue;

        // Emit simple progress updates for workflow steps.
        // This helps the UI feel responsive even when the router primarily streams routing-agent text.
        if (type === 'workflow-execution-event-workflow-step-start') {
          const stepName =
            (typeof (chunk as any)?.payload?.payload?.stepName === 'string' && (chunk as any).payload.payload.stepName) ||
            (typeof (chunk as any)?.payload?.payload?.id === 'string' && (chunk as any).payload.payload.id) ||
            '';
          if (stepName) {
            sse.write({ type: 'delta', text: `\n${stepName} workflow is starting...\n` });
          }
        }
        if (type === 'workflow-execution-event-workflow-step-result') {
          const stepName =
            (typeof (chunk as any)?.payload?.payload?.stepName === 'string' && (chunk as any).payload.payload.stepName) ||
            (typeof (chunk as any)?.payload?.payload?.id === 'string' && (chunk as any).payload.payload.id) ||
            '';
          if (stepName) {
            sse.write({ type: 'delta', text: `\n${stepName} workflow has finished execution\n` });
          }
        }

        // Best-effort text streaming across event variants.
        if (type.includes('text-delta')) {
          const payload = (chunk as any)?.payload ?? {};
          const delta =
            (typeof payload?.text === 'string' && payload.text) ||
            (typeof payload?.delta === 'string' && payload.delta) ||
            (typeof (chunk as any)?.text === 'string' && (chunk as any).text) ||
            '';
          if (delta) sse.write({ type: 'delta', text: delta });
        }

        // If a step finished with a final router result, capture it.
        if (type === 'network-execution-event-step-finish') {
          const result = (chunk as any)?.payload?.result;
          if (typeof result === 'string') finalText = result;
          if (result && typeof result?.text === 'string') finalText = result.text;
          logger.debug('router.network.step_finish', { traceId, hasResult: !!result });
        }
      }
    }

    // Fallback: await explicit result promise if present.
    if (!finalText) {
      const r = (networkRun as any)?.result ? await (networkRun as any).result : null;
      // Mastra WorkflowResult<...> shape is { status: 'success', result: <output> } on success.
      const rr = (r && typeof r === 'object' && 'result' in (r as any)) ? (r as any).result : null;
      finalText =
        (typeof r === 'string' && r) ||
        (typeof r?.text === 'string' && r.text) ||
        (typeof rr === 'string' && rr) ||
        (typeof rr?.text === 'string' && rr.text) ||
        null;
    }

    if (finalText) {
      // If we already streamed deltas, this may be a repeat; still send a final event so the client can close cleanly.
      logger.info('router.chat.complete', { traceId, projectId, hasFinalText: true });
      sse.write({ type: 'final', text: finalText });
    } else {
      logger.warn('router.chat.no_final_text', { traceId, projectId });
      sse.write({
        type: 'error',
        message: 'Router finished but did not return a final text. Check server logs for chunk shapes.',
      });
    }
  } catch (err: unknown) {
    logger.error('router.chat.error', { traceId, error: err instanceof Error ? err.message : 'Failed' });
    sse.write({ type: 'error', message: err instanceof Error ? err.message : 'Failed' });
  } finally {
    sse.close();
  }
});


