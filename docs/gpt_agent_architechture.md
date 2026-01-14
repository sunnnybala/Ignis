# Ignis Agent Architecture (Flowcharts)
 
This doc is meant to be pasted into GitHub/Notion and rendered as diagrams.
It reflects the **current backend code** under `backend/src/mastra/*` and `backend/src/routes/*`.
 
## System overview (Mastra-first)
 
```mermaid
flowchart TD
  %% ==== Clients / entrypoints ====
  U[User / Frontend UI] -->|HTTP| API[Express API]
 
  %% ==== Main Mastra chat entrypoint ====
  API -->|POST /router/:projectId/chat (SSE)| RTE[Router Route<br/>`backend/src/routes/router.ts`]
  RTE -->|builds RequestContext<br/>userId + projectId + traceId + routerStatus| RC[Mastra RequestContext]
  RTE -->|mastra.getAgent('ignisRouterAgent')<br/>agent.network(...)| IRA[Ignis Router Agent<br/>`ignisRouterAgent`]
 
  %% ==== Router selects ONE primitive ====
  IRA -->|chooses exactly one primitive| PRIM{Primitive chosen?}
 
  PRIM -->|Workflow| WF[Mastra Workflow]
  PRIM -->|Follow-up Agent| FA[Generalist/Follow-up Agent]
  PRIM -->|No primitive<br/>(clarify / confirm overwrite)| OUT0[Response only]
 
  %% ==== Workflows (phase-gated) ====
  WF --> NR[noveltyRefineWorkflow]
  WF --> PI[planImplementWorkflow]
  WF --> PPW[paperPlanWriteWorkflow]
 
  %% ==== Follow-up agents (phase-gated) ====
  FA --> RAG[researchAgent]
  FA --> PIA[planImplementAgent]
  FA --> PWA[paperWritingAgent]
 
  %% ==== Shared runtime dependencies ====
  subgraph MastraRuntime[Mastra runtime]
    MASTRA[Mastra instance<br/>`backend/src/mastra/index.ts`]
    OBS[Observability<br/>`@mastra/observability`]
    LOG[Pino Logger<br/>`@mastra/loggers`]
    STORE[LibSQLStore<br/>`:memory:`]
  end
 
  IRA --- MASTRA
  WF --- MASTRA
  FA --- MASTRA
  MASTRA --- OBS
  MASTRA --- LOG
  MASTRA --- STORE
 
  %% ==== LLM provider used by Mastra agents ====
  MASTRA -->|model: geminiModel| VTX[Google Vertex AI<br/>Gemini 3 Pro Preview<br/>`backend/src/mastra/model.ts`]
 
  %% ==== Tools used by workflows/agents ====
  subgraph Tools[Mastra Tools]
    RF[read_file]
    WF2[write_file]
    RLR[read_latest_results]
    GLI[get_latest_result_images]
    WS[web_search]
    SP[search_papers]
  end
 
  %% ==== Storage / persistence (DB-backed VFS + Supabase signed URLs) ====
  RF --> VFS[(DB-backed VFS<br/>`files` table via Drizzle)]
  WF2 --> VFS
  RLR --> VFS
  GLI --> VFS
  GLI -->|sign URLs| SUPA[Supabase Storage]
 
  %% ==== Outputs ====
  NR --> OUT1[Writes Research/* artifacts]
  PI --> OUT2[Writes Design/* + Experimentation/* artifacts]
  PPW --> OUT3[Writes Final_Paper/* artifacts]
```
 
## Paper generation (Mastra `paperPlanWriteWorkflow` — detailed)
 
```mermaid
flowchart TD
  IN[Input: selectedJournal (default \"General\")] --> S1
 
  %% Step 1: gather context via tools
  S1[gather_paper_context] -->|read_file| F1[Research/refined_idea.md]
  S1 -->|read_file| F2[Design/design_plan.md]
  S1 -->|read_file| F3[Design/dataset.json]
  S1 -->|read_file| F4[Experimentation/experiment.py]
  S1 -->|read_latest_results| F5[Results/<runId>/results.txt]
  S1 -->|get_latest_result_images| F6[Signed figure URLs<br/>(Supabase)]
  S1 --> BUNDLE[promptBundle<br/>(single stitched prompt)]
 
  %% Step 2: plan outline + figure placement
  BUNDLE --> S2[plan_paper]
  S2 -->|mastra.getAgent('paperPlannerAgent')| PPA[paperPlannerAgent]
  PPA -->|model: geminiModel| GEM[Vertex Gemini 3 Pro Preview]
  PPA -->|optional tool| WS[web_search]
  S2 --> PLAN[paperPlan JSON<br/>(outline + figurePlan)]
 
  %% Step 3: write LaTeX + metadata, then persist via tool
  PLAN --> S3[write_paper]
  BUNDLE --> S3
  S3 -->|mastra.getAgent('latexWriterAgent')| LWA[latexWriterAgent]
  LWA -->|model: geminiModel| GEM
  S3 --> OUTLATEX[latex JSON]
  S3 -->|write_file (replace)| TEX[Final_Paper/paper.tex]
  S3 -->|write_file (replace)| META[Final_Paper/paper_metadata.json]
```
 
## Legacy paper route (OpenAI direct — still present)
 
The backend also has a non-Mastra path for paper generation:
 
```mermaid
flowchart TD
  U[User / Frontend UI] -->|HTTP| API[Express API]
  API -->|POST /paper/:projectId/generate| PR[paper.ts]
 
  PR -->|loads inputs from DB| DB[(files table)]
  PR -->|signed URLs| SUPA[Supabase Storage]
  PR -->|OpenAI chat.completions| OAI[OpenAI model<br/>(vision-capable)]
  OAI -->|delimited output| PARSE[parseDelimitedResponse]
  PARSE -->|persist| DB
  DB -->|paper.tex + meta| DONE[Final Paper/* artifacts<br/>(legacy paths)]
```
 

