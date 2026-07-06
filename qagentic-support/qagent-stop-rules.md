# QAgent Stop Rules

QAgentic continuation must stop when any of the following is true:

1. The original objective is satisfied.
2. Validation passes for the requested behavior.
3. Remaining gaps are only polish, refactor, or speculative improvement.
4. More continuation would expand scope beyond the user request.
5. Required information is missing from the user and cannot be safely inferred.
6. The iteration cap is reached.
7. The next action requires explicit human approval.

## Iteration Caps

- `tiny`: 1 QAgent iteration maximum.
- `small`: 3 QAgent iterations maximum.
- `medium`: 5 QAgent iterations maximum.
- `large`: 8 QAgent iterations maximum.

## Cost Rule

If confidence improvement from another iteration is low, stop and report the unresolved risk instead of spending more tokens.

## Safety Rule

Never continue into destructive operations, credential changes, production deployment, irreversible migrations, or sensitive data storage without explicit human approval.
