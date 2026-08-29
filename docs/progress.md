# Progress

State that must survive between iterations. Context does not — this file does.
The loop reads it at the start of every iteration and commits it with the work.
Keep it short: working state, not a changelog — git history is the changelog.

## Current

- **In flight:** nothing in the repo. The box spike's human-only part (subscription login inside the box, a run billed to the subscription, one request through the host VPN, share of the weekly limit) is with the owner.
- **Where it stands:** monorepo skeleton (`apps/{web,api,worker}` + `packages/contracts`, compose stack on :3050, `/api/health`, gate + CI with GHCR push from `main`). Box image `box/Dockerfile` (unmodified `claude` 2.1.251 behind the ACP adapter 0.16.2) plus the spike package `box/spike`; every spike question has a measured answer in `box/README.md`. Next: the ComputerProvider and the ACP runtime, designed from the spike findings — the gate is a `PreToolUse` hook inside the box (ACP permission requests alone miss read-only shell and in-cwd reads), usage comes from the transcript, the model is pinned through settings in the box, the CDP endpoint is an IP.
- **Decisions taken unless the owner objects:** a denied action ends the turn (the runtime re-prompts); the ACP adapter stays for now despite its unused second CLI copy (123 MB).

## Failed approaches (do not retry)

- Pinning the model through `_meta.claudeCode.options.model` on `session/new` or through `ANTHROPIC_MODEL` in the box: the adapter calls `setModel(models[0])` after start and the run goes to the default model (Opus). Use `"model"` in the project's `.claude/settings.json`.
- Playwright MCP with `--cdp-endpoint http://host.docker.internal:9222`: Chrome rejects any `Host` header that is not an IP address or `localhost`. Use the address the name resolves to inside the box.
- Reading usage or cost from ACP: adapter 0.16.2 drops the CLI's `result` message and never sends `usage_update`. Tail the session transcript in the box instead.

## Open questions for the owner

- none
