Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Task: <write your task here>

Task size: tiny or small.

Rules:
- Do not modify AGENTS.md.
- Preserve existing features.
- Use Token-Minimal Coding Mode.
- Reuse existing code and agents before creating new ones.
- Patch only necessary files.
- Do not rewrite the whole project.
- Do not invent files, APIs, imports, tests, assets, or sync results.
- Do not run full project discovery unless required.
- Do not run full Neo4j/D3 regeneration unless required.
- However, always perform mandatory incremental Neo4j, D3, vector memory, prompt ledger, and observability updates when project artifacts are modified.
- Use ChromaDB fallback if OpenAI Vector Store is missing.
- Follow ROOT_WORKSPACE_GENERATION_POLICY.md.

Validation:
- Run lint/build/test if available.
- If a command cannot run, explain why.

After completion, report:
- files modified
- changes made
- validation result
- Neo4j update status
- vector memory provider used
- Agentic System D3 page path
