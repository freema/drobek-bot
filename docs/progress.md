# Progress

State that must survive between iterations. Context does not — this file does.
The loop reads it at the start of every iteration and commits it with the work.
Keep it short: working state, not a changelog — git history is the changelog.

## Current

- **In flight:** monorepo skeleton (`feat/monorepo-skeleton`) — pnpm workspace with `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`; compose stack (postgres, redis, api, worker, web); gate and CI. Implementation done and verified locally; tests from the test agent and the blind e2e pass are next.
- **Where it stands:** `docker compose up -d --build --wait` brings the stack up healthy, `/api/health` reports version, commit and the three checks, the web page renders them, `task check` is green. Next after this lands: the runtime spike on the owner's machine.

## Failed approaches (do not retry)

- none yet

## Open questions for the owner

- ESLint 9 is deprecated upstream (end of support); the skeleton uses ESLint 10 with the same flat config and typescript-eslint rules. Confirm or pin back to 9.
