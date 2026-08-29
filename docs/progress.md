# Progress

State that must survive between iterations. Context does not — this file does.
The loop reads it at the start of every iteration and commits it with the work.
Keep it short: working state, not a changelog — git history is the changelog.

## Current

- **In flight:** the thin-box ACP spike (`box/`, branch `spike/thin-box-acp`) — image, host-side probes and findings are in `box/README.md`; awaiting the owner's read of the findings before the ComputerProvider and the ACP runtime are designed.
- **Where it stands:** monorepo skeleton in place — `apps/{web,api,worker}` + `packages/contracts`; compose stack (postgres, redis, api, worker, web on :3050); `/api/health` reports version, commit and the postgres/redis/worker checks; gate (`task verify` = typecheck, lint, tests) and CI (gate + image builds, GHCR push from `main`). ESLint 10 is the lint baseline. The box image (`box/Dockerfile`) builds and runs the unmodified `claude` 2.1.251 behind the ACP adapter 0.16.2; all seven spike questions have measured answers.

## Failed approaches (do not retry)

- Pinning the model through `_meta.claudeCode.options.model` on `session/new` or through `ANTHROPIC_MODEL` in the box: the adapter calls `setModel(models[0])` after start and the run goes to the default model (Opus). Use `"model"` in the project's `.claude/settings.json`.
- Playwright MCP with `--cdp-endpoint http://host.docker.internal:9222`: Chrome rejects any `Host` header that is not an IP address or `localhost`. Use the address the name resolves to inside the box.
- Reading usage or cost from ACP: adapter 0.16.2 drops the CLI's `result` message and never sends `usage_update`. Tail the session transcript in the box instead.

## Open questions for the owner

- Read-only shell commands and `Read` inside the working directory never reach the permission gate (auto-allowed by the CLI before `canUseTool`); only a `PreToolUse` hook sees every tool call. Is "gate only what the CLI escalates" acceptable for the walking skeleton, or must the runtime own a hook inside the box?
- A rejected permission aborts the whole turn (the adapter answers with `interrupt: true`); the model cannot continue past a denied action within the same prompt. Acceptable, or should the runtime re-prompt after a deny?
- The adapter bundles a second copy of the CLI (2.1.44, via its Agent SDK dependency) that is never executed; it costs 123 MB of image. Live with it, or replace the adapter with a direct Agent SDK driver later?
