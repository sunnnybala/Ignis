# Ignis Agent Architecture (Flowcharts)
 
This doc is meant to be pasted into GitHub/Notion and rendered as diagrams.
It reflects the **current backend code** under `backend/src/mastra/*` and `backend/src/routes/*`.
 
## System overview (Mastra-first)
 
```mermaid
flowchart TD
  %% ==== Clients / entrypoints ====
  U[User / Frontend UI] -->|HTTP| API[Express API]

  %% ==== Main Mastra chat entrypoint ====
  API -->|POST /router/:projectId/chat (SSE)| RTE[Router Route (backend/src/routes/router.ts)]
  RTE -->|builds RequestContext| RC[Mastra RequestContext<br/>userId + projectId + traceId + routerStatus]
  RTE -->|mastra.getAgent ignisRouterAgent| IRA[Ignis Router Agent]

  %% ==== Router selects ONE primitive ====
  IRA -->|chooses exactly one primitive| PRIM{Primitive chosen?}

  PRIM -->|Workflow| MWF[Mastra Workflow]
  PRIM -->|Follow-up Agent| FA[Follow-up Agent]
  PRIM -->|No primitive| OUT0[Response only]

  %% ==== Workflows (phase-gated) ====
  MWF --> NR[noveltyRefineWorkflow]
  MWF --> PI[planImplementWorkflow]
  MWF --> PPW[paperPlanWriteWorkflow]

  %% ==== Follow-up agents (phase-gated) ====
  FA --> RAG[researchAgent]
  FA --> PIA[planImplementAgent]
  FA --> PWA[paperWritingAgent]

  %% ==== Shared runtime dependencies ====
  subgraph MastraRuntime[Mastra Runtime]
    MASTRA[Mastra Instance<br/>(backend/src/mastra/index.ts)]
    OBS[Observability<br/>@mastra/observability]
    LOG[Pino Logger<br/>@mastra/loggers]
    STORE[LibSQLStore<br/>:memory:]
  end

  IRA --- MASTRA
  MWF --- MASTRA
  FA --- MASTRA
  MASTRA --- OBS
  MASTRA --- LOG
  MASTRA --- STORE

  %% ==== LLM provider ====
  MASTRA -->|model: geminiModel| VTX[Vertex AI<br/>Gemini 3 Pro Preview<br/>(backend/src/mastra/model.ts)]

  %% ==== Tools used by agents/workflows ====
  subgraph Tools[Mastra Tools]
    RF[read_file]
    WF_TOOL[write_file]
    RLR[read_latest_results]
    GLI[get_latest_result_images]
    WS_TOOL[web_search]
    SP[search_papers]
  end

  %% ==== Storage / persistence ====
  RF --> VFS[(DB-backed VFS<br/>files table via Drizzle)]
  WF_TOOL --> VFS
  RLR --> VFS
  GLI --> VFS
  GLI -->|sign URLs| SUPA[Supabase Storage]

  %% ==== Outputs ====
  NR --> OUT1[Research/* artifacts]
  PI --> OUT2[Design/* + Experimentation/* artifacts]
  PPW --> OUT3[Final_Paper/* artifacts]
```
 
## Paper generation (Mastra `paperPlanWriteWorkflow` — detailed)
 
```mermaid
flowchart TD
  IN[Input: selectedJournal (default General)] --> S1

  %% Step 1: gather context via tools
  S1[gather_paper_context] -->|read_file| F1[Research/refined_idea.md]
  S1 -->|read_file| F2[Design/design_plan.md]
  S1 -->|read_file| F3[Design/dataset.json]
  S1 -->|read_file| F4[Experimentation/experiment.py]
  S1 -->|read_latest_results| F5[Results/run_id/results.txt]
  S1 -->|get_latest_result_images| F6[Signed figure URLs (Supabase)]
  S1 --> BUNDLE[promptBundle<br/>(single stitched prompt)]

  %% Step 2: plan outline + figure placement
  BUNDLE --> S2[plan_paper]
  S2 -->|mastra.getAgent paperPlannerAgent| PPA[paperPlannerAgent]
  PPA -->|model: geminiModel| GEM[Vertex Gemini 3 Pro Preview]
  PPA -->|optional tool| WS2[web_search]
  S2 --> PLAN[paperPlan JSON<br/>(outline + figurePlan)]

  %% Step 3: write LaTeX + metadata
  PLAN --> S3[write_paper]
  BUNDLE --> S3
  S3 -->|mastra.getAgent latexWriterAgent| LWA[latexWriterAgent]
  LWA -->|model: geminiModel| GEM
  S3 --> OUTLATEX[latex JSON]
  S3 -->|write_file replace| TEX[Final_Paper/paper.tex]
  S3 -->|write_file replace| META[Final_Paper/paper_metadata.json]
```
 
## Legacy paper route (OpenAI direct — still present)
 
The backend also has a non-Mastra path for paper generation:
 
```mermaid
flowchart TD
  U[User / Frontend UI] -->|HTTP| API[Express API]
  API -->|POST /paper/:projectId/generate| PR[paper.ts route]

  PR -->|load inputs| DB[(files table)]
  PR -->|signed URLs| SUPA[Supabase Storage]
  PR -->|OpenAI chat.completions| OAI[OpenAI vision-capable model]
  OAI -->|delimited output| PARSE[parseDelimitedResponse]
  PARSE -->|persist| DB
  DB --> DONE[Final_Paper artifacts<br/>(legacy paths)]
```
 

