# Ignis Agent Architecture Flowchart

## Main Architecture Overview
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

    subgraph PPWAgents["Paper Write Agents"]
        PPA[Paper Planner]
        LWA[LaTeX Writer]
    end
    subgraph PIWAgents["Plan Implement Agents"]
        IPA[Implementation Planner]
        ECA[Experiment Coder]
    end
    subgraph NRWAgents["Novelty Refine Agents"]
        QBA[Query Builder]
        MRW[Mini Review Worker]
        CLR[Consolidate Lit Review]
        CNA[Consolidate Novelty]
        RIA[Refine Idea]
    end
    subgraph FollowUp["Follow-up Agents"]
        RA[Research Agent]
        PIA[Plan & Implement Agent]
        PWA[Paper Writing Agent]
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

    style QBA fill:#ce93d8
    style MRW1 fill:#ce93d8
    style MRW2 fill:#ce93d8
    style MRW3 fill:#ce93d8
    style CLR fill:#ce93d8
    style CNA fill:#ce93d8
    style RIA fill:#ce93d8
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

    style PPA fill:#ce93d8
    style LWA fill:#ce93d8
```

---

## Evaluation Framework



### 1. Literature Review & Novelty Assessment

> **Objective:** Validate the quality and originality of research synthesis produced by the Novelty Refine Workflow.

| Metric | Description | Benchmark Reference |
|--------|-------------|---------------------|
| **ResearcherBench Comparison** | Evaluate against 65 frontier AI research questions spanning literature review tasks | [ResearcherBench](https://arxiv.org/abs/2507.16280) |
| **Citation Recency** | Measure % of citations from last 3 years | [Sakana AI Scientist Eval](https://arxiv.org/abs/2502.14297) |
| **Citation Relevance** | Semantic similarity between cited papers and research topic | [IdeaBench](https://arxiv.org/html/2411.02429v1) |
| **False Novelty Detection** | Check for misclassification of established concepts as novel | [Hidden Pitfalls Paper](https://arxiv.org/pdf/2509.08713) |

**Key Outputs Evaluated:**
- `Research/lit_review.md`
- `Research/novelty_assessment.md`
- `Research/refined_idea.md`

---

### 2. Code Generation (experiment.py)

> **Objective:** Measure the reliability and correctness of generated experiment code executed on Modal.

| Metric | Description | 
|--------|-------------|
| **Execution Success Rate** | % of experiments that run without errors on Modal | 
| **Result Reproducibility** | Same code produces identical results across multiple runs |
| **Resource Efficiency** | GPU utilization and runtime within expected bounds |

**Key Outputs Evaluated:**
- `Experimentation/experiment.py`
- `Experimentation/requirements.txt`
- `Results/<timestamp>/results.txt`

---

### 3. Paper Generation

> **Objective:** Assess the quality, accuracy, and academic rigor of generated LaTeX papers.

| Metric | Description | Methodology |
|--------|-------------|-------------|
| **LLM Reviewer Score** | Simulated peer review using GPT-4o | [Sakana methodology](https://sakana.ai/ai-scientist-first-publication/): 5 rounds self-reflection + ensemble reviews |
| **Factual Consistency** | Claims in paper match actual experimental results | Cross-reference `results.txt` with paper assertions |
| **Citation Quality** | Relevance, recency, and proper attribution | Target: >10 citations median, >50% from last 5 years |
| **Structural Completeness** | No missing figures, placeholders, or repeated sections | Automated LaTeX validation |

**Key Outputs Evaluated:**
- `Final_Paper/paper.tex`
- `Final_Paper/paper_metadata.json`

---

### Cost Estimate

> **Each end-to-end evaluation test costs approximately $15 in cloud credits.**

- LLM API calls (Vertex AI / Gemini) across all three workflow phases
- Modal GPU compute for experiment execution

---

### Real-World Validation

> **We have a waitlist of 150+ users.**

Our eventual goal is to have actual users validate Ignis by using it to automate their research workflows. 