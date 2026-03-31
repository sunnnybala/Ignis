# Ignis

An AI-powered research co-pilot that takes you from a rough idea to a submission-ready paper. Ignis automates the full ML research lifecycle: literature review, novelty assessment, experiment design, code generation, cloud execution, and paper writing.

You describe your research idea. Ignis searches the literature, checks if it's novel, designs experiments, writes and runs the code on cloud GPUs, and drafts a LaTeX paper. You stay in the loop at every step.

## How It Works

Ignis follows a three-phase pipeline, each powered by specialized AI agents:

**Phase 1: Research and Novelty Assessment**
- You describe your idea in the chat
- The system searches Semantic Scholar and Exa for related papers
- Papers are paired and analyzed for relevance, then consolidated into a literature review and novelty assessment
- Your idea is refined based on the findings
- Output: `Research/lit_review.md`, `Research/novelty_assessment.md`, `Research/refined_idea.md`

**Phase 2: Experiment Design and Execution**
- An implementation planner designs the experiment and selects a Kaggle dataset
- A coding agent writes `experiment.py` and `requirements.txt`
- You review the code in the Forge editor, then trigger execution on Modal (serverless GPU)
- Results (metrics, plots, CSVs) are uploaded back automatically
- Output: `Design/design_plan.md`, `Design/dataset.json`, `Experimentation/experiment.py`, `Results/`

**Phase 3: Paper Writing**
- A paper planner outlines the structure using your results, experiment code, and literature review
- A LaTeX writer produces the full paper with figures and citations
- You edit in the Athena editor with live PDF preview
- Output: `Final_Paper/paper.tex`, `Final_Paper/paper_metadata.json`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express.js 5 + TypeScript, Mastra agent framework |
| Frontend | React 19 + Vite, Shadcn/ui, Monaco Editor, TanStack Query |
| Database | PostgreSQL via Drizzle ORM (hosted on Railway) |
| Auth | Supabase (JWT + Google OAuth) |
| Storage | Supabase Object Storage (artifacts, PDFs, images) |
| LLM | Google Vertex AI (Gemini 3 Pro Preview) |
| Compute | Modal (serverless Python/GPU for experiments) |
| Paper Search | Semantic Scholar + Exa API |
| Datasets | Kaggle API |

## Project Structure

```
MVP/
  backend/
    src/
      index.ts                  # Express app entry point
      db/
        schema.ts               # Drizzle table definitions (users, projects, jobs, files, creditsLedger)
        client.ts               # PostgreSQL connection pool
      routes/
        router.ts               # POST /router/:projectId/chat (main SSE endpoint)
        projects.ts             # CRUD for projects
        files.ts                # File read/write/download
        jobs.ts                 # Experiment execution + Modal integration
        paper.ts                # LaTeX compilation
        stream.ts               # Job progress SSE (stub)
      middleware/
        auth.ts                 # Supabase JWT verification
        requestContext.ts       # Request ID + timing
      authz/
        ownership.ts            # User-project-file-job authorization
      mastra/
        index.ts                # Mastra instance (13 agents, 3 workflows)
        model.ts                # Gemini 3 Pro model config
        agents/                 # 13 specialized agents
        workflows/              # 3 multi-step workflows
        tools/                  # Search, VFS, experiment, Kaggle tools
      services/
        latexCompiler.ts        # Tectonic LaTeX to PDF
      storage/
        supabaseAdapter.ts      # Supabase S3-like storage wrapper
      utils/
        logger.ts               # Structured PinoLogger
        sse.ts                  # Server-Sent Events helper
        datasetConfig.ts        # Kaggle dataset config parser
  frontend/
    src/
      App.tsx                   # React Router (SPA)
      auth/
        AuthProvider.tsx        # Supabase auth context
        RequireAuth.tsx         # Route guard
      pages/
        Landing.tsx             # Public landing page
        Home.tsx                # Dashboard
        HomeProjects.tsx        # Project list + creation
        Forge.tsx               # Experiment workspace (editor + chat)
        Athena.tsx              # Paper writing (LaTeX + PDF preview)
      components/
        ChatPanel.tsx           # Agent chat with SSE streaming
        ForgeMain.tsx           # Monaco editor + chat split view
        ForgeSidebar.tsx        # File tree browser
        landing/                # Public site components
        ui/                     # Shadcn component library
      lib/
        api.ts                  # HTTP client for all backend calls
        chat.ts                 # SSE streaming client
        chatTypes.ts            # Event type definitions
        supabaseClient.ts       # Supabase init
  modal_runner/
    runner.py                   # Modal serverless function (dataset download, experiment execution, artifact upload)
  docs/
    agent-architecture-flowchart.md  # Mermaid diagrams of agent workflows
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database (Railway recommended)
- Supabase project (for auth + storage)
- Google Cloud service account with Vertex AI access
- Modal account (for experiment execution)
- Kaggle account (for dataset access)

### Backend Setup

```bash
cd backend
npm install
cp .env.example .env   # Fill in all required values (see Environment Variables below)
npm run db:migrate      # Run Drizzle migrations
npm run dev             # Starts on localhost:4000
```

### Frontend Setup

```bash
cd frontend
npm install
cp env.example .env     # Fill in API URL and Supabase keys
npm run dev             # Starts on localhost:5173
```

### Modal Runner

```bash
pip install modal
modal deploy modal_runner/runner.py
```

## Environment Variables

### Backend

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name |
| `SUPABASE_JWKS_URL` | JWKS endpoint for JWT verification |
| `SUPABASE_JWT_ISSUER` | Expected JWT issuer |
| `SUPABASE_JWT_AUD` | Expected JWT audience |
| `CORS_ORIGIN` | Allowed frontend origins (comma-separated) |
| `MODAL_RUNNER_URL` | Modal function endpoint |
| `PUBLIC_BASE_URL` | Backend public URL (for Modal callbacks) |
| `GOOGLE_VERTEX_PROJECT` | GCP project ID |
| `GOOGLE_VERTEX_LOCATION` | GCP region |
| `GOOGLE_CLIENT_EMAIL` | GCP service account email |
| `GOOGLE_PRIVATE_KEY` | GCP service account private key |
| `EXA_API_KEY` | Exa search API key |
| `KAGGLE_USERNAME` | Kaggle username |
| `KAGGLE_KEY` | Kaggle API key |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) |

### Frontend

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Backend URL (e.g., `http://localhost:4000`) |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_AUTH_REDIRECT_URL` | OAuth callback URL |
| `VITE_FORMSPREE_ID` | Waitlist form ID |

## API Overview

### Authentication
All endpoints require `Authorization: Bearer <supabase_jwt>` except health checks and Modal callbacks.

### Key Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/router/:projectId/chat` | Main chat endpoint (SSE streaming) |
| `GET` | `/projects` | List user's projects |
| `POST` | `/projects` | Create a new project |
| `GET` | `/projects/:id/files/tree` | Get project file tree |
| `GET` | `/files/:id` | Get file content |
| `PUT` | `/files/:id` | Update file content |
| `GET` | `/files/:id/url` | Get signed download URL |
| `POST` | `/jobs/experiment/:projectId/run` | Run experiment on Modal |
| `POST` | `/paper/:projectId/compile` | Compile LaTeX to PDF |
| `GET` | `/jobs/:jobId` | Get job status |
| `GET` | `/health` | Health check |

### SSE Event Types

The chat endpoint streams these event types:

| Type | Description |
|------|-------------|
| `delta` | Streaming text chunk |
| `final` | Complete response text |
| `file_update` | Agent wrote/updated a file |
| `phase` | Workflow phase changed |
| `action_request` | Agent requests user action (run experiment, generate paper) |
| `error` | Error message |

## Agent Architecture

Ignis uses 13 specialized AI agents orchestrated by the Mastra framework. The router agent (`ignisRouterAgent`) dispatches user messages to the right workflow or follow-up agent based on the current project phase and file state.

See [docs/agent-architecture-flowchart.md](docs/agent-architecture-flowchart.md) for detailed Mermaid diagrams of each workflow.

### Agents by Role

**Router**: `ignisRouterAgent` ... dispatches to workflows and follow-up agents

**Research** (Phase 1): `queryBuilderAgent`, `miniReviewWorkerAgent`, `consolidateLitReviewAgent`, `consolidateNoveltyAgent`, `refineIdeaAgent`

**Implementation** (Phase 2): `implementationPlannerAgent`, `experimentCoderAgent`

**Paper** (Phase 3): `paperPlannerAgent`, `latexWriterAgent`

**Follow-up** (any phase): `researchAgent`, `planImplementAgent`, `paperWritingAgent`

**Utility**: `vfsAgent` (virtual filesystem operations)

## Testing

```bash
cd backend
npm test              # Run all 197 tests (Vitest)
npm run test:watch    # Watch mode
```

Tests are co-located with source files (`*.test.ts` next to `*.ts`). Uses `vi.mock()` for dependency injection with mocks for the database, auth, and logger.

## Evaluation Framework

Ignis includes an evaluation framework for measuring output quality across all three phases:

- **Literature Review**: ResearcherBench comparison, citation recency/relevance, false novelty detection
- **Code Generation**: Execution success rate, reproducibility, resource efficiency
- **Paper Generation**: LLM reviewer scores, factual consistency, citation quality, structural completeness

Each end-to-end evaluation costs ~$15 in cloud credits.

See [docs/agent-architecture-flowchart.md](docs/agent-architecture-flowchart.md) for the full evaluation metrics table.

## License

TBD
