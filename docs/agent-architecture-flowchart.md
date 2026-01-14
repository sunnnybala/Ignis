# Ignis Agent Architecture Flowchart

## Main Architecture Overview

```mermaid
flowchart TB
    subgraph User["User Interface"]
        U[User Message]
    end

    subgraph Router["Orchestration Layer"]
        IR[Ignis Router Agent]
        RS{Route Decision}
    end

    subgraph Phase1["Phase 1: Research"]
        NRW[noveltyRefineWorkflow]
        RA[Research Agent<br/>Follow-up]
    end

    subgraph Phase2["Phase 2: Implementation"]
        PIW[planImplementWorkflow]
        PIA[Plan & Implement Agent<br/>Follow-up]
    end

    subgraph Phase3["Phase 3: Paper Writing"]
        PPW[paperPlanWriteWorkflow]
        PWA[Paper Writing Agent<br/>Follow-up]
    end

    U --> IR
    IR --> RS

    RS -->|"Research incomplete"| NRW
    RS -->|"Research complete,<br/>edit needed"| RA
    RS -->|"Implementation incomplete"| PIW
    RS -->|"Implementation complete,<br/>edit needed"| PIA
    RS -->|"Paper incomplete"| PPW
    RS -->|"Paper complete,<br/>edit needed"| PWA

    NRW -.->|"produces"| RF1[Research/<br/>lit_review.md<br/>novelty_assessment.md<br/>refined_idea.md]
    PIW -.->|"produces"| RF2[Design/<br/>design_plan.md<br/>dataset.json<br/><br/>Experimentation/<br/>experiment.py<br/>requirements.txt]
    PPW -.->|"produces"| RF3[Final_Paper/<br/>paper.tex<br/>paper_metadata.json]

    style IR fill:#e1f5fe
    style NRW fill:#fff3e0
    style PIW fill:#f3e5f5
    style PPW fill:#e8f5e9
    style RA fill:#fff3e0
    style PIA fill:#f3e5f5
    style PWA fill:#e8f5e9
```

---

## Novelty Refine Workflow (Phase 1)

```mermaid
flowchart TB
    subgraph Input
        UI[User Idea + Conversation]
    end

    subgraph Step1["Step 1: Query Generation"]
        QBA[Query Builder Agent]
    end

    subgraph Step2["Step 2: Paper Search"]
        SPT[searchPapersTool]
        SS[(Semantic Scholar<br/>or Exa fallback)]
    end

    subgraph Step3["Step 3: Pair Papers"]
        PP[Pair Papers<br/>into batches of 2]
    end

    subgraph Step4["Step 4: Parallel Analysis"]
        direction LR
        MRW1[Mini Review<br/>Worker 1]
        MRW2[Mini Review<br/>Worker 2]
        MRW3[Mini Review<br/>Worker N]
    end

    subgraph Step5["Step 5: Consolidation (Parallel)"]
        direction TB
        subgraph Parallel["Run in Parallel"]
            CLR[Consolidate<br/>Lit Review Agent]
            CNA[Consolidate<br/>Novelty Agent]
        end
        RIA[Refine Idea Agent]
    end

    subgraph Outputs["Output Files"]
        LR[Research/lit_review.md]
        NA[Research/novelty_assessment.md]
        RI[Research/refined_idea.md]
    end

    UI --> QBA
    QBA -->|"search query"| SPT
    SPT --> SS
    SS -->|"papers list"| PP
    PP -->|"pair 1"| MRW1
    PP -->|"pair 2"| MRW2
    PP -->|"pair N"| MRW3

    MRW1 --> CLR
    MRW2 --> CLR
    MRW3 --> CLR
    MRW1 --> CNA
    MRW2 --> CNA
    MRW3 --> CNA

    CLR --> LR
    CNA --> NA
    CLR --> RIA
    CNA --> RIA
    RIA --> RI

    style QBA fill:#ffcc80
    style MRW1 fill:#ffcc80
    style MRW2 fill:#ffcc80
    style MRW3 fill:#ffcc80
    style CLR fill:#ffcc80
    style CNA fill:#ffcc80
    style RIA fill:#ffcc80
```

---

## Plan & Implement Workflow (Phase 2)

```mermaid
flowchart TB
    subgraph Inputs["Input (from Phase 1)"]
        RI[Research/refined_idea.md]
    end

    subgraph Step1["Step 1: Planning"]
        IPA[Implementation<br/>Planner Agent]
        WST1[webSearchTool<br/>for Kaggle datasets]
    end

    subgraph Step2["Step 2: Code Generation"]
        ECA[Experiment<br/>Coder Agent]
    end

    subgraph Outputs["Output Files"]
        DP[Design/design_plan.md]
        DS[Design/dataset.json]
        EP[Experimentation/experiment.py]
        RQ[Experimentation/requirements.txt]
    end

    RI --> IPA
    IPA <--> WST1
    IPA -->|"design_plan.md<br/>dataset.json"| DP
    IPA --> DS

    RI --> ECA
    DP --> ECA
    DS --> ECA

    ECA -->|"experiment.py<br/>requirements.txt"| EP
    ECA --> RQ

    style IPA fill:#ce93d8
    style ECA fill:#ce93d8
```

---

## Paper Plan & Write Workflow (Phase 3)

```mermaid
flowchart TB
    subgraph Inputs["Inputs (from Phase 1 & 2)"]
        RI[refined_idea.md]
        DP[design_plan.md]
        DS[dataset.json]
        EP[experiment.py]
        RES[Results/<timestamp>/<br/>results.txt + images]
    end

    subgraph Step1["Step 1: Gather Context"]
        GC[Gather Context<br/>Pure Step]
        RLR[readLatestResultsTool]
        GLI[getLatestResultImagesTool]
    end

    subgraph Step2["Step 2: Plan Paper"]
        PPA[Paper Planner Agent<br/>Multimodal]
        WST[webSearchTool]
    end

    subgraph Step3["Step 3: Write Paper"]
        LWA[LaTeX Writer Agent<br/>Multimodal]
    end

    subgraph Outputs["Output Files"]
        PT[Final_Paper/paper.tex]
        PM[Final_Paper/paper_metadata.json]
    end

    RI --> GC
    DP --> GC
    DS --> GC
    EP --> GC
    RES --> RLR
    RES --> GLI
    RLR --> GC
    GLI --> GC

    GC -->|"prompt bundle<br/>+ signed image URLs"| PPA
    PPA <--> WST
    PPA -->|"outline + figure plan"| LWA
    GC --> LWA

    LWA --> PT
    LWA --> PM

    style PPA fill:#a5d6a7
    style LWA fill:#a5d6a7
```

---

## Complete Agent Hierarchy

```mermaid
flowchart LR
    subgraph Orchestration["Orchestration"]
        IR[Ignis Router Agent]
    end

    subgraph Workflows["Workflows"]
        NRW[noveltyRefineWorkflow]
        PIW[planImplementWorkflow]
        PPW[paperPlanWriteWorkflow]
    end

    subgraph FollowUp["Follow-up Agents"]
        RA[Research Agent]
        PIA[Plan & Implement Agent]
        PWA[Paper Writing Agent]
    end

    subgraph NRWAgents["Novelty Refine Agents"]
        QBA[Query Builder]
        MRW[Mini Review Worker]
        CLR[Consolidate Lit Review]
        CNA[Consolidate Novelty]
        RIA[Refine Idea]
    end

    subgraph PIWAgents["Plan Implement Agents"]
        IPA[Implementation Planner]
        ECA[Experiment Coder]
    end

    subgraph PPWAgents["Paper Write Agents"]
        PPA[Paper Planner]
        LWA[LaTeX Writer]
    end

    subgraph Utility["Utility"]
        VFS[VFS Agent]
    end

    IR --> NRW
    IR --> PIW
    IR --> PPW
    IR --> RA
    IR --> PIA
    IR --> PWA

    NRW --> QBA
    NRW --> MRW
    NRW --> CLR
    NRW --> CNA
    NRW --> RIA

    PIW --> IPA
    PIW --> ECA

    PPW --> PPA
    PPW --> LWA

    style IR fill:#e1f5fe,stroke:#01579b
    style NRW fill:#fff3e0,stroke:#e65100
    style PIW fill:#f3e5f5,stroke:#7b1fa2
    style PPW fill:#e8f5e9,stroke:#2e7d32
```

---

## Tools & Data Flow

```mermaid
flowchart TB
    subgraph Tools["Available Tools"]
        SPT[searchPapersTool<br/>Semantic Scholar / Exa]
        RFT[readFileTool<br/>VFS Read]
        WFT[writeFileTool<br/>VFS Write]
        WST[webSearchTool<br/>General Web]
        RLR[readLatestResultsTool<br/>Experiment Results]
        GLI[getLatestResultImagesTool<br/>Result Figures]
    end

    subgraph Agents["Agents Using Tools"]
        RA[Research Agent]
        PIA[Plan & Implement Agent]
        PWA[Paper Writing Agent]
        IPA[Implementation Planner]
        PPA[Paper Planner]
        VFS[VFS Agent]
    end

    SPT --> RA
    SPT --> VFS

    RFT --> RA
    RFT --> PIA
    RFT --> PWA
    RFT --> VFS

    WFT --> RA
    WFT --> PIA
    WFT --> PWA
    WFT --> VFS

    WST --> PIA
    WST --> PWA
    WST --> IPA
    WST --> PPA
    WST --> VFS

    RLR --> PIA
    RLR --> PWA

    GLI --> PWA

    style SPT fill:#bbdefb
    style RFT fill:#bbdefb
    style WFT fill:#bbdefb
    style WST fill:#bbdefb
    style RLR fill:#bbdefb
    style GLI fill:#bbdefb
```

---

## Phase Gates & State Machine

```mermaid
stateDiagram-v2
    [*] --> ResearchIncomplete: New Project

    ResearchIncomplete --> ResearchComplete: noveltyRefineWorkflow completes
    ResearchComplete --> ResearchComplete: researchAgent (edits)

    ResearchComplete --> ImplIncomplete: User requests implementation
    ImplIncomplete --> ImplComplete: planImplementWorkflow completes
    ImplComplete --> ImplComplete: planImplementAgent (edits)

    ImplComplete --> PaperIncomplete: User requests paper
    PaperIncomplete --> PaperComplete: paperPlanWriteWorkflow completes
    PaperComplete --> PaperComplete: paperWritingAgent (edits)

    note right of ResearchIncomplete
        lit_review.md = empty
        novelty_assessment.md = empty
        refined_idea.md = empty
    end note

    note right of ImplIncomplete
        design_plan.md = empty
        dataset.json = empty
        experiment.py = empty
    end note

    note right of PaperIncomplete
        paper.tex = empty
    end note
```

---

## Summary Table

| Agent | Category | Phase | Tools |
|-------|----------|-------|-------|
| **Ignis Router** | Orchestration | All | None (dispatches) |
| **Research Agent** | Follow-up | 1 | read, write, search_papers |
| **Plan & Implement Agent** | Follow-up | 2 | read, write, web_search, latest_results |
| **Paper Writing Agent** | Follow-up | 3 | read, write, web_search, latest_results, images |
| **Query Builder** | Workflow | 1 | None |
| **Mini Review Worker** | Workflow | 1 | None |
| **Consolidate Lit Review** | Workflow | 1 | None |
| **Consolidate Novelty** | Workflow | 1 | None |
| **Refine Idea** | Workflow | 1 | None |
| **Implementation Planner** | Workflow | 2 | web_search |
| **Experiment Coder** | Workflow | 2 | None |
| **Paper Planner** | Workflow | 3 | web_search |
| **LaTeX Writer** | Workflow | 3 | None |
| **VFS Agent** | Utility | - | read, write, web_search, search_papers |
