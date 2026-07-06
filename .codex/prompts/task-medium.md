Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Task: <write your task here>

Task size: medium.

Rules:
- Do not modify AGENTS.md.
- Preserve existing features.
- Analyze only relevant project areas first.
- Reuse existing agents before creating new ones.
- Create or update agents only when required.
- Patch focused areas instead of rewriting the whole app.
- Update Neo4j graph artifacts for changed components and functionality.
- Update Agentic System D3 page.
- Store redacted task prompt, decisions, and validation summary in vector memory.
- Use ChromaDB fallback if OpenAI Vector Store is missing.
- Follow ROOT_WORKSPACE_GENERATION_POLICY.md.

Validation:
- Run lint/build/test if available.
- Validate affected functionality.
- Validate responsive/accessibility impact if UI is changed.
- If a command cannot run, explain why.

After completion, report:
- files modified
- agents used or updated
- implementation summary
- validation result
- Neo4j update status
- vector memory provider used
- Agentic System D3 page path
