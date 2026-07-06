Optional new-project bootstrap prompt for QAgentic support.

Use this only when creating or bootstrapping a new project, or when the user explicitly requests QAgentic support for an existing project.

Additive requirements:
- Do not replace AGENTS.md or any existing orchestrator instruction.
- Append or verify the QAgentic support section only.
- Create missing qagentic-support/ framework files.
- Create schemas/qagent-next-instruction.schema.json if missing.
- Create .codex/prompts/task-qagentic.md if missing.
- Create observability/qagentic/latest-qagentic-bootstrap.json.
- Add QAgent Controller as a system/support agent in project-local topology.
- Add graph/D3/Neo4j relationships only when the project already uses those topology artifacts.

Behavior:
- QAgent Controller reviews the previous agent response against the original objective.
- It detects missing work, weak validation, incomplete implementation, or unclear next steps.
- It outputs a structured Next Instruction Packet.
- It decides whether to continue or stop.
- It obeys task iteration caps: tiny=1, small=3, medium=5, large=8.
- It must not execute code directly.

Stop when:
- the objective is complete;
- validation passes;
- continuation would only polish or over-engineer;
- required user information is missing;
- max iterations are reached.
