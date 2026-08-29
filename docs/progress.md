# Progress

State that must survive between iterations. Context does not — this file does.
The loop reads it at the start of every iteration and commits it with the work.
Keep it short: working state, not a changelog — git history is the changelog.

## Current

- **In flight:** nothing.
- **Where it stands:** monorepo skeleton in place — `apps/{web,api,worker}` + `packages/contracts`; compose stack (postgres, redis, api, worker, web on :3050); `/api/health` reports version, commit and the postgres/redis/worker checks; gate (`task verify` = typecheck, lint, tests) and CI (gate + image builds, GHCR push from `main`). ESLint 10 is the lint baseline. Next: the runtime spike on the owner's machine, then the ComputerProvider and the ACP runtime.

## Failed approaches (do not retry)

- none yet

## Open questions for the owner

- none
