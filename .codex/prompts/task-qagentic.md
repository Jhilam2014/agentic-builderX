Read AGENTS.md, qagentic-support/README.md, qagentic-support/qagent-controller.md, and qagentic-support/qagent-stop-rules.md before acting.

Enable QAgentic continuation review for this task.

Task type: tiny | small | medium | large
Task: <write the user objective here>

Rules:
- Preserve existing features and project behavior.
- Reuse existing project agents before creating a runtime QAgent.
- Runtime QAgents may be generated only for blocking or important objective gaps.
- QAgents must not execute code directly.
- QAgents output only a stop decision or a Next Instruction Packet matching schemas/qagent-next-instruction.schema.json.
- Stop when the objective is complete, validation passes, only polish remains, required user information is missing, or the task iteration cap is reached.

Iteration caps:
- tiny: 1
- small: 3
- medium: 5
- large: 8

Completion:
- Compare the previous response against the original objective.
- Check changed files and validation evidence.
- If complete, stop and report validation.
- If incomplete, emit one precise Next Instruction Packet for the next agent/model.
