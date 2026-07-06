Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

Enable orchestrator-agent mode.

Task: <write your task here>

Task size: large.

Rules:
- Do not modify AGENTS.md.
- Preserve existing features.
- Perform project discovery before implementation.
- Build execution topology.
- Create or reuse specialist agents.
- Break the work into tasks and assign to agents.
- Update local agent files under agents/generated/.
- Update Neo4j graph database artifacts for agents, workflows, components, APIs, services, files, and functionalities.
- Update Agentic System D3 page.
- Store redacted prompts, agent decisions, execution summaries, and validation summaries in vector memory.
- Use ChromaDB fallback if OpenAI Vector Store is missing.
- Follow ROOT_WORKSPACE_GENERATION_POLICY.md.

Validation:
- Run lint/build/test if available.
- Validate critical workflows.
- Check regression risk.
- If a command cannot run, explain why.

After completion, report:
- workflow created
- agents used or created
- tasks completed
- files modified
- validation result
- Neo4j update status
- vector memory provider used
- Agentic System D3 page path
