# Ignis User Guide

Ignis is your AI research assistant that takes your idea from concept to publication-ready paper.

---

## How It Works

Ignis guides you through three phases. Each phase builds on the previous one.

```
Your Idea  →  Research  →  Implementation  →  Paper
```

---

## Phase 1: Research

**Goal:** Validate and refine your idea against existing literature.

### Steps

1. **Submit your idea**
   - Describe your research idea in detail
   - Include the problem you're solving, your approach, and expected outcomes
   - The more context you provide, the better the research

**Good Example:**
> "I want to explore using transformer attention mechanisms to predict protein folding stability. My hypothesis is that attention weights can capture long-range amino acid interactions better than CNNs. I expect this to improve prediction accuracy and provide interpretable attention patterns that highlight key structural interactions."

**Bad Example:**
> "bro just make me a paper on LLMs pls"

2. **Clarification (if needed)**
   - If your idea is vague, Ignis will ask 2-4 clarifying questions

3. **Literature review**
   - Ignis searches academic databases for related papers
   - It analyzes how your idea relates to existing works and find    gaps, overlaps, and novelty signals

4. **Review the outputs**
   - `Research/lit_review.md` — Consolidated literature review
   - `Research/novelty_assessment.md` — How novel is your idea?
   - `Research/refined_idea.md` — Your idea, enhanced to improve novelty

### What to do next

- **Satisfied?** Tell Ignis to proceed to implementation
- **Want changes?** Ask Ignis to revise specific aspects
- **Start over?** Request a reset (you'll need to confirm)

---

## Phase 2: Implementation

**Goal:** Create a working experiment from your refined idea.

### Steps

1. **Request implementation**
   - Simply ask Ignis to move to implementation

2. **Design planning**
   - Ignis creates an experiment design plan
   - Selects an appropriate dataset from Kaggle

3. **Code generation**
   - Generates `experiment.py` based on the design plan

4. **Review the outputs**
   - `Design/design_plan.md` — Experiment methodology
   - `Design/dataset.json` — Dataset configuration
   - `Experimentation/experiment.py` — Ready-to-run code
   - `Experimentation/requirements.txt` — Dependencies

### What to do next

- **Run the experiment** 
- **Request edits** to the code or design plan
- **Go back** to revise the research if needed

---

## Phase 3: Paper Writing

**Goal:** Generate a publication-ready LaTeX paper.

### Steps

1. **Run your experiment first**
   - Execute `experiment.py` to generate results
   - Results and figures are saved automatically

2. **Request paper generation**
   - Ask Ignis to write the paper
   - Optionally specify a target journal

3. **LaTeX generation**
   - Writes a complete paper with proper citations
   - Estimates publication probability

4. **Review the outputs**
   - `Final_Paper/paper.tex` — Complete LaTeX source
   - `Final_Paper/paper_metadata.json` — Journal suggestions

### What to do next

- **Edit the paper** with specific requests
- **Regenerate** with a different journal style

---

## Quick Reference

| Phase | Input | Output |
|-------|-------|--------|
| Research | Your idea | Literature review, novelty assessment, refined idea |
| Implementation | Refined idea | Design plan, dataset config, experiment code |
| Paper | Experiment results | LaTeX paper, Suggested Journals, publication probability |

---
  
## Tips

- **Be specific** — Detailed ideas lead to better research
- **Review each phase** — Check outputs before moving forward

---

## Example Prompts

**Starting research:**
> "I want to explore using transformer attention mechanisms to predict protein folding stability. My hypothesis is that attention weights can capture long-range amino acid interactions better than CNNs."

**Moving to implementation:**
> "The research looks good. Let's proceed to implementation."

**Requesting edits:**
> "Can you update the experiment to use a larger batch size and add early stopping?"

**Writing the paper:**
> "Generate the paper targeting NeurIPS format."

---

**Built with Ignis**

Because your idea deserves better than to remain a half-finished Overleaf doc.
