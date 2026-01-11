import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { getLogLevel } from '../utils/env';
import { noveltyRefineWorkflow } from './workflows/novelty-refine-workflow';
import { planImplementWorkflow } from './workflows/plan-implement-workflow';
import { paperPlanWriteWorkflow } from './workflows/paper-plan-write-workflow';
import { vfsAgent } from './agents/vfs-agent';
import { researchAgent } from './agents/research-agent';
import { planImplementAgent } from './agents/plan-implement-agent';
import { queryBuilderAgent } from './agents/query-builder-agent';
import { miniReviewWorkerAgent } from './agents/mini-review-worker-agent';
import { consolidateLitReviewAgent } from './agents/consolidate-lit-review-agent';
import { consolidateNoveltyAgent } from './agents/consolidate-novelty-agent';
import { refineIdeaAgent } from './agents/refine-idea-agent';
import { implementationPlannerAgent } from './agents/implementation-planner-agent';
import { experimentCoderAgent } from './agents/experiment-coder-agent';
import { paperPlannerAgent } from './agents/paper-planner-agent';
import { latexWriterAgent } from './agents/latex-writer-agent';
import { paperWritingAgent } from './agents/paper-writing-agent';
import { ignisRouterAgent } from './agents/ignis-router-agent';


export const mastra = new Mastra({
  workflows: { noveltyRefineWorkflow, planImplementWorkflow, paperPlanWriteWorkflow },
  agents: {
    vfsAgent,
    researchAgent,
    planImplementAgent,
    queryBuilderAgent,
    miniReviewWorkerAgent,
    consolidateLitReviewAgent,
    consolidateNoveltyAgent,
    refineIdeaAgent,
    implementationPlannerAgent,
    experimentCoderAgent,
    paperPlannerAgent,
    latexWriterAgent,
    paperWritingAgent,
    ignisRouterAgent,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: getLogLevel(),
  }),
  observability: new Observability({
    // Enables DefaultExporter and CloudExporter for tracing
    default: { enabled: true },
  }),
});
