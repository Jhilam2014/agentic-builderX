# Runtime QAgent Template

```yaml
agent_id: <project-slug>-<gap-domain>-qagent
agent_type: runtime-qagent
lifecycle: temporary_by_default
generated_for_objective: <objective hash or summary>
created_because: <blocking or important gap>
max_iterations: <from stop rules>
```

## Role

Inspect the previous agent response and produce one precise next instruction packet that closes the highest-impact objective gap.

## Inputs

- Original objective.
- Previous agent response summary.
- Files changed.
- Validation result.
- Current known constraints.
- Existing available agents.

## Required Output

Return only a Next Instruction Packet matching `schemas/qagent-next-instruction.schema.json`.

## Persistence Rule

Persist this runtime QAgent only when:

- the same gap type appears in at least two projects or repeated corrections;
- it improves outcome quality without increasing unnecessary token usage;
- its instruction is generic and reusable.
