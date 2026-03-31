Ignis is an AI-powered research co-pilot that automates the full lifecycle of ML research, from literature review and novelty assessment to experiment design, code generation, cloud execution, and paper writing. The goal is to let researchers go from a rough idea to a submission-ready paper with minimal manual effort.

**What we've built so far:**

1. **Autonomous dataset sourcing** — The agent architecture can pull datasets from multiple sources (Kaggle, PubChem, Campbell, etc.) without user intervention.
2. **Cloud experiment execution** — Using Modal's MCP, the agent autonomously runs code on cloud servers, retrieves experimental results, and iteratively improves the code (no user involvement required). (hoang's advice from the last meet!)
3. **RAG-powered paper formatting** — A retrieval-augmented database lets the agent pull in journal-specific formatting guidelines when writing papers, so output conforms to the target venue's style.

**Next steps:**

- **Open-sourcing the project** — Each of us has significant competing commitments right now, and the project needs more hands than we can provide. Going open-source will help us attract contributors and accelerate development.
- **Writing a research paper** — We plan to write up the system and submit to relevant conferences.

**Where we'd appreciate help:**

1. Getting listed as a **GSoC project** (mentorship, referrals, or guidance on the application)
2. Identifying the **right research conferences** to target, and occasional **feedback on our paper drafts**