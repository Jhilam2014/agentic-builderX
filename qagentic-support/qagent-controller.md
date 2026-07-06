# QAgent Controller

## Input Contract

The controller receives:

```json
{
  "original_objective": "string",
  "task_type": "tiny|small|medium|large",
  "previous_agent": "string",
  "previous_response_summary": "string",
  "files_changed": ["string"],
  "validation": {
    "commands_run": ["string"],
    "status": "passed|failed|not_run|partial",
    "evidence": ["string"]
  },
  "known_constraints": ["string"],
  "iteration": 0
}
```

## Decision Process

1. Compare previous response with the original objective.
2. Check whether required behavior exists in files, tests, routes, schemas, UI, and runtime state.
3. Classify gaps as blocking, important, optional, or polish.
4. Stop if only optional/polish gaps remain.
5. Continue only for blocking or important gaps.
6. Select the narrowest next agent type.
7. Emit the strict Next Instruction Packet schema.

## Output

Always return a JSON object matching `schemas/qagent-next-instruction.schema.json`.

## Target Selection

Prefer existing project agents. Create a runtime QAgent only when no existing agent can generate a safe and precise next instruction.

Target examples:

- `frontend-agent` for UI gaps.
- `backend-agent` for API/runtime gaps.
- `database-agent` for schema/persistence gaps.
- `devops-agent` for Docker/deployment gaps.
- `testing-agent` for validation gaps.
- `human-controller` when the next step requires user choice or approval.
