# Architecture

## System Overview

Ignis is a three-tier application: a TypeScript backend with AI agent orchestration, a React single-page app, and a Python serverless compute layer for running experiments.

```
                         ┌──────────────────────────┐
                         │   React 19 + Vite SPA    │
                         │   (Vercel / localhost:5173)│
                         │                          │
                         │  Forge: code editor +    │
                         │         agent chat       │
                         │  Athena: LaTeX editor +  │
                         │          PDF preview     │
                         └────────────┬─────────────┘
                                      │ REST + SSE
                                      ▼
                         ┌──────────────────────────┐
                         │  Express.js 5 Backend    │
                         │  (Railway / localhost:4000)│
                         │                          │
                         │  13 Mastra Agents        │
                         │  3 Multi-step Workflows  │
                         │  Drizzle ORM (Postgres)  │
                         └──┬──────┬──────┬─────────┘
                            │      │      │
               ┌────────────┘      │      └────────────┐
               ▼                   ▼                   ▼
    ┌──────────────────┐ ┌────────────────┐ ┌──────────────────┐
    │  Railway Postgres │ │  Supabase      │ │  Google Vertex   │
    │                  │ │  - Auth (JWT)  │ │  AI              │
    │  users           │ │  - Storage     │ │  Gemini 3 Pro    │
    │  projects        │ │    (artifacts) │ │  Preview         │
    │  jobs            │ │                │ │                  │
    │  files           │ └────────────────┘ └──────────────────┘
    │  creditsLedger   │
    └──────────────────┘          ┌────────────────────────────┐
                                  │  Modal (Python Serverless) │
                                  │                            │
                                  │  Download Kaggle dataset   │
                                  │  Run experiment.py on GPU  │
                                  │  Upload artifacts back     │
                                  │  Callback to backend       │
                                  └────────────────────────────┘
```

## Backend Architecture

### Request Flow

A typical user message flows through the system like this:

1. Frontend POSTs to `/router/:projectId/chat` with the message and conversation history
2. `requestContext` middleware assigns a request ID for tracing
3. `requireAuth` middleware validates the Supabase JWT and extracts the user ID
4. The route handler queries the database to determine which project files exist and which agent primitives are allowed based on the current phase
5. `ignisRouterAgent` (the top-level dispatcher) reads the project state and routes to one workflow or follow-up agent
6. The selected workflow or agent runs, calling tools (paper search, file writes, experiment execution) as needed
7. Each step streams back to the frontend via Server-Sent Events

### Agent Orchestration (Mastra)

All 13 agents and 3 workflows are registered in a single Mastra instance (`backend/src/mastra/index.ts`). The Mastra framework provides:

- Agent definitions with system prompts, tools, and model configuration
- Workflow execution with step sequencing and concurrency control
- Memory (LibSQL, in-memory for now)
- Observability (OpenTelemetry-compatible tracing)
- Structured logging via PinoLogger

### Phase Gates

The router agent enforces a phase progression system. Projects move through phases:

```
refine → check_novelty → implementation_plan → implement → await_experiment → finalize_paper
```

Each phase has required files that must exist before the next workflow can run. The router checks the `files` table for non-empty content and only allows primitives whose prerequisites are satisfied. This prevents the LLM from skipping steps.

### Database Design

Five tables in PostgreSQL via Drizzle ORM:

**`users`** ... Identity. Linked to Supabase auth via email.

**`projects`** ... Each user can have multiple research projects. Tracks current phase, loop counts for iterative refinement, and approval flags.

**`files`** ... A virtual filesystem stored in the database. Each file has a `(projectId, path)` unique constraint, a type enum (txt, md, py, tex, pdf, img, csv, log), and either inline `content` (for text) or a `storageKey` pointing to Supabase Storage (for binary). Files track their origin (user, agent, or job) and optional SHA-256 hash.

**`jobs`** ... Tracks Modal experiment runs and paper compilations. Status transitions: `queued → running → completed | failed`. Includes attempt tracking with configurable max retries, JSONB metadata, and error codes.

**`creditsLedger`** ... Append-only ledger tracking credit usage per user. Each entry records a delta, reason (llm, experiment, pdf_compile, refund, manual_adjustment), and optional job reference.

### Authorization Model

Two layers:

1. **Authentication**: Supabase JWT verified via remote JWKS endpoint. The middleware extracts userId from the JWT `sub` claim.

2. **Authorization**: Every route that accesses a resource calls an ownership helper (`authz/ownership.ts`) that joins the resource table with `projects` and filters by `userId`. A user can only see their own projects, files, and jobs.

Public endpoints (health check, Modal callbacks) are allowlisted. Modal callbacks authenticate via a per-job token generated at job creation time.

### External Service Integration

**Google Vertex AI (Gemini 3 Pro Preview)**
All agents use the same model. Auth via service account credentials (`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`). The model config lives in `backend/src/mastra/model.ts`.

**Semantic Scholar + Exa**
The `searchPapersTool` tries Semantic Scholar first, falls back to Exa if results are insufficient. Returns normalized paper objects (title, authors, year, abstract, URL).

**Supabase Storage**
Binary artifacts (experiment output PNGs, CSVs, PDFs) are stored in a Supabase bucket (`ignis-projects-dev`). The backend generates signed upload/download URLs. The adapter is in `backend/src/storage/supabaseAdapter.ts`.

**Kaggle**
The implementation planner agent uses `kaggleDatasetInfoTool` to find datasets. The Modal runner downloads them to a shared volume with caching (markers: `.downloading`, `.ready`).

## Frontend Architecture

### SPA with React Router

The frontend is a single-page app deployed to Vercel. All routes rewrite to `index.html` (configured in `vercel.json`). React Router handles client-side navigation.

**Route structure**:
- `/` ... Landing page (public)
- `/login`, `/register` ... Auth pages
- `/auth/callback` ... OAuth redirect handler
- `/home/projects` ... Project dashboard (protected)
- `/forge/:projectId` ... Experiment workspace (protected)
- `/athena/:projectId` ... Paper writing (protected)

### Two Workspaces

**Forge** (`/forge/:projectId`): Split-panel layout with a file tree sidebar, Monaco code editor on the left, and the agent chat panel on the right. The panels are resizable. Files auto-save with a 1-second debounce. Markdown files get a preview mode.

**Athena** (`/athena/:projectId`): LaTeX editor with PDF compilation and preview. Includes journal selection, publication probability estimates, and paper metadata display.

### Data Fetching

TanStack React Query manages all server state. Query keys follow a consistent pattern (`['projects']`, `['files-tree', projectId]`, `['file', fileId]`). Mutations invalidate relevant queries on success.

The API client (`frontend/src/lib/api.ts`) handles auth headers, 401 auto-logout, and request ID injection.

### Real-Time Streaming

The chat panel uses Server-Sent Events via a custom `postChatStream()` function. The frontend POSTs a message and receives a stream of newline-delimited JSON events. Event types include text deltas, file updates, phase changes, and action requests (like "run experiment").

Chat history is stored in localStorage per project (`ignis-chat-${projectId}`).

### Styling

Tailwind CSS v4 with Shadcn/ui components (New York preset). Dark mode is on by default. The color system uses oklch color space via CSS custom properties.

## Modal Runner (Experiment Execution)

The Modal runner (`modal_runner/runner.py`) is a Python serverless function that:

1. Receives a JSON payload from the backend (experiment code, dataset config, requirements, callback URLs)
2. Downloads the Kaggle dataset to a shared Modal volume (with caching to avoid re-downloads)
3. Installs Python dependencies from `requirements.txt`
4. Executes `experiment.py` and captures stdout/stderr
5. Finds output artifacts (PNG, CSV files)
6. Requests presigned upload URLs from the backend
7. Uploads artifacts to Supabase Storage
8. Calls the backend's `/jobs/:jobId/complete` endpoint with results

The runner uses a shared volume (`ignis-datasets-cache`) for dataset persistence across invocations. Kaggle credentials are stored as a Modal secret.

## Logging and Observability

Backend logging uses Mastra's PinoLogger with a structured event naming convention: `{subsystem}.{operation}.{event}` (e.g., `router.chat.complete`, `workflow.novelty_refine.finish`).

Observability is enabled via Mastra's DefaultExporter + CloudExporter for OpenTelemetry-compatible tracing. Each request gets a unique `requestId` for correlation.

## Deployment

| Component | Platform | Notes |
|-----------|----------|-------|
| Backend | Railway | Auto-deploy from git, Postgres addon |
| Frontend | Vercel | Static SPA, `vercel.json` for SPA routing |
| Modal Runner | Modal | `modal deploy modal_runner/runner.py` |
| Database | Railway | PostgreSQL, SSL auto-detected |
| Auth + Storage | Supabase | Managed, separate project |
| LLM | Google Cloud | Vertex AI, Gemini 3 Pro Preview |
