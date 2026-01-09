# Ignis Backend

Express.js API server with Mastra AI agent orchestration for the Ignis research platform.

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL with Drizzle ORM
- **AI/Agents**: Mastra framework (multi-agent orchestration)
- **LLM**: OpenAI API
- **Auth**: Supabase JWT
- **Storage**: Supabase (file storage)
- **Remote Execution**: Modal (experiment jobs)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Supabase account
- OpenAI API key

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
DATABASE_URL=postgres://user:pass@host:5432/dbname
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJhbG...
SUPABASE_PRIVATE_KEY=eyJhbG...
CORS_ORIGIN=http://localhost:5173
MODAL_RUNNER_URL=https://...modal.run
PUBLIC_BASE_URL=http://localhost:4000
NODE_ENV=development
PORT=4000
```

### Database Setup

```bash
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio (DB viewer)
npm run db:reset     # Reset and re-migrate (destructive)
```

### Development

```bash
npm run dev          # Start with hot reload (localhost:4000)
npm run mastra:dev   # Start Mastra observability dashboard
```

### Production

```bash
npm run build        # Compile TypeScript
npm start            # Run compiled output
```

## Project Structure

```
src/
├── index.ts              # Express app entry point
├── db/
│   ├── client.ts         # Database connection
│   └── schema.ts         # Drizzle schema (users, projects, jobs, files)
├── mastra/
│   ├── index.ts          # Mastra instance + agent registrations
│   ├── agents/           # 13 specialized LLM agents
│   ├── workflows/        # Multi-step agent workflows
│   └── tools/            # Agent tools (file I/O, search)
├── routes/
│   ├── router.ts         # Main agent chat endpoint (SSE)
│   ├── jobs.ts           # Job management + Modal callbacks
│   ├── projects.ts       # Project CRUD
│   ├── files.ts          # File tree + content
│   └── paper.ts          # Paper generation workflow
├── middleware/
│   ├── auth.ts           # Supabase JWT validation
│   └── requestContext.ts # Request ID injection
├── authz/                # Authorization (ownership checks)
├── services/             # Business logic (LaTeX compiler)
└── utils/                # Utilities (SSE, logging)
```

## API Routes

| Route | Description |
|-------|-------------|
| `POST /router/:projectId/step` | Main agent interaction (SSE stream) |
| `GET/POST /projects` | Project CRUD |
| `GET /files/:projectId/tree` | File tree |
| `GET/PUT /files/:fileId` | File content |
| `POST /jobs` | Create experiment/compile job |
| `POST /jobs/:jobId/complete` | Modal callback (public) |
| `POST /paper/:projectId/generate` | Generate paper |
| `POST /paper/:projectId/compile` | Compile LaTeX to PDF |
| `GET /health` | Health check |

## Mastra Agents

The platform uses 13 specialized agents orchestrated by a router:

- `ignisRouterAgent` - Top-level dispatcher
- `researchAgent` - Literature review
- `refineIdeaAgent` - Idea clarification
- `queryBuilderAgent` - Search query generation
- `miniReviewWorkerAgent` - Mini literature reviews
- `consolidateLitReviewAgent` - Consolidate findings
- `consolidateNoveltyAgent` - Novelty assessment
- `implementationPlannerAgent` - Design planning
- `planImplementAgent` - Multi-step planning
- `experimentCoderAgent` - Generate experiment.py
- `paperPlannerAgent` - Paper structure
- `latexWriterAgent` - LaTeX generation
- `paperWritingAgent` - Paper content

## Workflows

- `noveltyRefineWorkflow` - Research phase
- `planImplementWorkflow` - Implementation phase
- `paperPlanWriteWorkflow` - Paper generation phase

## Scripts

```bash
npm run dev          # Development server with hot reload
npm run build        # Compile TypeScript to dist/
npm start            # Run production build
npm run lint         # Run ESLint
npm run format       # Run Prettier
npm run db:generate  # Generate Drizzle migrations
npm run db:migrate   # Apply migrations
npm run db:reset     # Reset database
npm run db:studio    # Open Drizzle Studio
npm run mastra:dev   # Mastra observability dashboard
```
