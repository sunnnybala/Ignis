# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ignis is an AI-powered research paper generation and experimentation platform. Full-stack TypeScript application combining LLM agents (Mastra framework), workflow automation, and cloud-based experiment execution via Modal.

## Development Commands

### Backend (`/backend`)
```bash
npm run dev          # Start dev server (localhost:4000)
npm run build        # Compile TypeScript
npm run db:generate  # Generate Drizzle migrations
npm run db:migrate   # Run migrations
npm run db:reset     # Reset DB + migrate
npm run db:studio    # Open Drizzle Studio
npm run mastra:dev   # Start Mastra observability dashboard
```

### Frontend (`/frontend`)
```bash
npm run dev          # Start Vite dev server (localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
```

### Modal Runner (`/modal_runner`)
```bash
modal deploy modal_runner/runner.py  # Deploy serverless function
```

## Architecture

### Three-Tier Structure
- **Backend**: Express.js API with Mastra agent orchestration, Drizzle ORM (PostgreSQL), Supabase auth/storage
- **Frontend**: React 19 + Vite, Shadcn, Monaco Editor, TanStack Query
- **Modal Runner**: Python serverless GPU compute for experiment execution

### Key Workflows (Mastra)
- `noveltyRefineWorkflow` - Research phase (query builder → mini reviews → consolidation)
- `planImplementWorkflow` - Implementation (design plan → experiment.py)
- `paperPlanWriteWorkflow` - Paper generation (planner → LaTeX writer)

### 13 Specialized Agents
Router agent (`ignisRouterAgent`) dispatches to specialized agents:
- Research: `researchAgent`, `queryBuilderAgent`, `miniReviewWorkerAgent`, `consolidateLitReviewAgent`, `consolidateNoveltyAgent` , `refineIdeaAgent`,
- Implementation: `implementationPlannerAgent`, `planImplementAgent`, `experimentCoderAgent`
- Paper: `paperPlannerAgent`, `latexWriterAgent`, `paperWritingAgent`
- Utility: `vfsAgent`

## Key Files

| Purpose | Path |
|---------|------|
| Backend entry | `backend/src/index.ts` |
| DB schema | `backend/src/db/schema.ts` |
| Mastra setup | `backend/src/mastra/index.ts` |
| Router agent | `backend/src/mastra/agents/ignis-router-agent.ts` |
| Main chat endpoint | `backend/src/routes/router.ts` |
| Jobs/Modal integration | `backend/src/routes/jobs.ts` |
| Paper workflow | `backend/src/routes/paper.ts` |
| Frontend routes | `frontend/src/App.tsx` |
| API client | `frontend/src/lib/api.ts` |
| Experiment workspace | `frontend/src/pages/Forge.tsx` |
| Paper writing UI | `frontend/src/pages/Athena.tsx` |

## Database (Drizzle + PostgreSQL)

Core tables: `users`, `projects`, `jobs`, `files`, `creditsLedger`

Project files stored hierarchically with `(projectId, path)` uniqueness. Jobs track Modal execution with status: queued → running → completed/failed.

## API Patterns

- **SSE streaming**: `/router/:projectId/step` streams agent responses
- **Job callbacks**: Modal calls `/jobs/:jobId/complete` (public, job-token auth)
- **Authorization**: All routes filtered by userId from JWT; ownership checked in `authz/ownership.ts`

## External Services

- **Supabase**: Auth (JWT), PostgreSQL, file storage
- **Google Vertex AI**: LLM provider for all Mastra agents (Gemini 3 Pro)
- **Modal**: Serverless GPU for experiment.py execution
- **Kaggle**: Dataset sourcing

## Environment Variables

Backend requires: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_PRIVATE_KEY`, `CORS_ORIGIN`, `MODAL_RUNNER_URL`, `PUBLIC_BASE_URL`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`

Frontend requires: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Logging

Unified logging via Mastra's PinoLogger (`backend/src/utils/logger.ts`). Import and use:

```typescript
import { logger } from '../utils/logger';

logger.debug('jobs.run.inputs', { traceId, projectId });  // Dev-only verbose
logger.info('jobs.run.start', { traceId });               // Business events
logger.warn('tool.fallback', { reason });                 // Recoverable issues
logger.error('workflow.failed', { error });               // Failures
```

**Log levels**: `debug` | `info` | `warn` | `error`

**Control via**: `LOG_LEVEL` env var (defaults to `debug` in dev, `info` in prod)

**Event naming**: `{subsystem}.{operation}.{event}` (e.g., `router.chat.complete`, `workflow.novelty_refine.finish`)

## Testing

### Backend (`/backend`)
```bash
npm test             # Run all tests (Vitest)
npm run test:watch   # Watch mode
```

**Framework**: Vitest with `vi.mock()` for dependency injection

**Test structure**: Co-located `*.test.ts` files next to source (e.g., `routes/files.test.ts`)

**Mocking patterns**:
- Use `vi.hoisted()` for mocks needed before module imports
- Mock `../utils/logger` to suppress output
- Mock `../authz/ownership` to control auth checks
- Mock `../db/client` with chained query builders
- Extract route handlers via `router.stack` for direct testing

**Coverage**: Utils, middleware, authorization, route handlers, and services (197 tests)

