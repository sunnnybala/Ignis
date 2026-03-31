# Contributing to Ignis

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL (local or Railway)
- Python 3.11+ (for Modal runner)
- A Supabase project
- Google Cloud service account with Vertex AI enabled
- Modal CLI (`pip install modal`)
- Kaggle account and API key

## Local Development Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd MVP
```

Install backend and frontend dependencies:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure environment

**Backend**: Copy `backend/.env.example` to `backend/.env` and fill in:
- `DATABASE_URL` ... PostgreSQL connection string
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` ... Supabase credentials
- `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUD` ... JWT verification
- `SUPABASE_STORAGE_BUCKET` ... Storage bucket name
- `GOOGLE_VERTEX_PROJECT`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` ... Vertex AI
- `MODAL_RUNNER_URL`, `PUBLIC_BASE_URL` ... Modal integration
- `EXA_API_KEY` ... Paper search
- `KAGGLE_USERNAME`, `KAGGLE_KEY` ... Dataset sourcing
- `CORS_ORIGIN` ... Set to `http://localhost:5173`

**Frontend**: Copy `frontend/env.example` to `frontend/.env` and fill in:
- `VITE_API_BASE_URL` ... Set to `http://localhost:4000`
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` ... Same Supabase project
- `VITE_AUTH_REDIRECT_URL` ... Set to `http://localhost:5173`

### 3. Set up the database

```bash
cd backend
npm run db:migrate    # Run Drizzle migrations
npm run db:studio     # (Optional) Open Drizzle Studio to inspect tables
```

### 4. Deploy the Modal runner

```bash
pip install modal
modal deploy modal_runner/runner.py
```

Copy the deployed function URL into `MODAL_RUNNER_URL` in your backend `.env`.

### 5. Start development servers

In two terminal windows:

```bash
# Terminal 1: Backend
cd backend
npm run dev           # localhost:4000

# Terminal 2: Frontend
cd frontend
npm run dev           # localhost:5173
```

Open `http://localhost:5173` in your browser.

## Project Layout

```
backend/
  src/
    index.ts              # Express entry point
    db/schema.ts          # Drizzle table definitions
    routes/               # API route handlers
    middleware/            # Auth, request context
    authz/                # Ownership checks
    mastra/
      agents/             # 13 specialized agents
      workflows/          # 3 multi-step workflows
      tools/              # Agent tools (search, VFS, experiments)
    services/             # LaTeX compilation
    storage/              # Supabase adapter
    utils/                # Logger, SSE, config parsers

frontend/
  src/
    pages/                # Route-level components
    components/           # Reusable components + Shadcn UI
    auth/                 # Auth provider + route guard
    lib/                  # API client, SSE, types

modal_runner/
  runner.py               # Serverless experiment execution
```

## Running Tests

```bash
cd backend
npm test              # Run all tests (Vitest, ~197 tests)
npm run test:watch    # Watch mode for development
```

Tests are co-located with source files (e.g., `routes/files.ts` has `routes/files.test.ts`).

### Mocking patterns

- Use `vi.hoisted()` for mocks that need to exist before module imports
- Mock `../utils/logger` to suppress log output in tests
- Mock `../authz/ownership` to control authorization in route tests
- Mock `../db/client` with chained query builders for database tests
- Extract route handlers via `router.stack` for direct handler testing without spinning up Express

## Code Style

- **Formatting**: Prettier (single quotes, trailing commas, 100 char width)
- **Indentation**: Tabs (configured in `.editorconfig`)
- **Linting**: ESLint with TypeScript plugin

```bash
cd backend && npm run lint
cd frontend && npm run lint
```

## Key Conventions

### Logging

Use the structured logger from `backend/src/utils/logger.ts`:

```typescript
import { logger } from '../utils/logger';

logger.info('jobs.run.start', { traceId, projectId });
logger.error('workflow.failed', { error });
```

Event names follow `{subsystem}.{operation}.{event}` format.

### API Routes

- All protected routes use `requireAuth` middleware
- Resource access goes through ownership helpers in `authz/ownership.ts`
- Streaming responses use the SSE utility from `utils/sse.ts`
- Public endpoints (Modal callbacks, health) are allowlisted in the auth middleware

### Agent Development

Agents are defined in `backend/src/mastra/agents/`. Each agent has:
- A system prompt describing its role and constraints
- A list of tools it can call
- The shared Gemini model from `mastra/model.ts`

Workflows are in `backend/src/mastra/workflows/`. Each workflow defines steps that run sequentially or concurrently, with data passed between steps via the workflow context.

To add a new agent:
1. Create the agent file in `backend/src/mastra/agents/`
2. Register it in `backend/src/mastra/index.ts`
3. If it should be callable from chat, add it as a primitive in `routes/router.ts`

### File System (VFS)

Project files live in the `files` database table, not on disk. Agents read and write files through `vfsUtils` and the `readFileTool`/`writeFileTool`. Binary files (images, PDFs) use Supabase Storage with a `storageKey` reference.

## Architecture Reference

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design, data flow diagrams, and deployment topology.

See [docs/agent-architecture-flowchart.md](docs/agent-architecture-flowchart.md) for Mermaid diagrams of each agent workflow.
