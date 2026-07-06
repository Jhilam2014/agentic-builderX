Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md fully.

The user may provide only:

Task type: tiny | small | medium | large
Task: <task description>

Automatically load the matching task template:

- tiny -> .codex/prompts/task-small.md
- small -> .codex/prompts/task-small.md
- medium -> .codex/prompts/task-medium.md
- large -> .codex/prompts/task-large.md

Apply the selected template completely.

Do not ask the user to paste the full template.

If the template file is missing, stop and report the missing path.

After loading the template, execute the task according to:

1. AGENTS.md
2. ROOT_WORKSPACE_GENERATION_POLICY.md
3. selected task template
4. user task

Do not modify AGENTS.md unless the user explicitly says to modify the canonical orchestrator instruction.
