# Progress

State that must survive between iterations. Context does not — this file does.
The loop reads it at the start of every iteration and commits it with the work.
Keep it short: working state, not a changelog — git history is the changelog.

## Current

- **In flight:** the bot folder format on branch `feat/bot-format`: schemas in `contracts` (`bot-format.ts`, `cron.ts`, `tool-pattern.ts`), the new package `packages/bot-format` (pure parsers, secret scan, catalog resolution, the mapping onto the box project, `loadBot` as the only I/O, `validate` CLI built to `dist/cli`), `catalog/mcp.json` with the six servers verified against vendor pages, the reference bot in `packages/bot-format/fixtures/inbox-briefing`, and `docs/bot-format.md`. Waiting on: the test-writing agent (unit tests from the spec against the exported functions), PR and merge. The box spike's human-only part (subscription login inside the box, a run billed to the subscription, one request through the host VPN, share of the weekly limit) is with the owner.
- **Where it stands:** monorepo skeleton (`apps/{web,api,worker}` + `packages/{contracts,core,db}`, compose stack on :3050, `/api/health`, gate + CI with GHCR push from `main`). Data model: shared enums in `contracts`, the run state machine in `core`, Drizzle schema and additive-only migrations in `db` (the api applies them on start; `pnpm db:migrate` from the host). `drizzle-kit generate` needs `NODE_OPTIONS=--conditions=development` (wired into the package script) so it reads `contracts` from source. Box image `box/Dockerfile` (unmodified `claude` 2.1.251 behind the ACP adapter 0.16.2) plus the spike package `box/spike`; every spike question has a measured answer in `box/README.md`. `tests/*` is a workspace glob; `tests/policy` (`@drobek-bot/policy-tests`) runs in the gate like every other package. README v1, `SETUP_PROMPT.md` and `llms.txt` are on `main`. Next: the ComputerProvider and the ACP runtime, designed from the spike findings — the gate is a `PreToolUse` hook inside the box (ACP permission requests alone miss read-only shell and in-cwd reads), usage comes from the transcript, the model is pinned through settings in the box, the CDP endpoint is an IP; the worker will feed `toClaudeProjectFiles()` output into the box and add the Playwright server with the resolved CDP address through the `mcpServers` option.
- **Decisions taken unless the owner objects:** a denied action ends the turn (the runtime re-prompts); the ACP adapter stays for now despite its unused second CLI copy (123 MB). In the bot format: `bot.yaml` `auth` has no default (unset until the owner picks one); a tool no policy list matches is left to the broker, which asks; `policy` is enforced from outside the box and never written into it; cron fields are bounds-checked (0-59, 0-23, 1-31, 1-12, 0-7) on top of the grammar; the app image (`Dockerfile`) does not carry `bot-format` yet — it is added when the worker starts using it.

## Failed approaches (do not retry)

- Pinning the model through `_meta.claudeCode.options.model` on `session/new` or through `ANTHROPIC_MODEL` in the box: the adapter calls `setModel(models[0])` after start and the run goes to the default model (Opus). Use `"model"` in the project's `.claude/settings.json`.
- Playwright MCP with `--cdp-endpoint http://host.docker.internal:9222`: Chrome rejects any `Host` header that is not an IP address or `localhost`. Use the address the name resolves to inside the box.
- Reading usage or cost from ACP: adapter 0.16.2 drops the CLI's `result` message and never sends `usage_update`. Tail the session transcript in the box instead.
- Running the `validate` CLI from source with `node --experimental-strip-types`: `contracts` is imported through its `exports` map and its source uses `.js` specifiers, which Node does not rewrite. The CLI is built to `dist/cli` and the `validate` script builds its dependency chain first.

## Open questions for the owner

- Slack's remote MCP server (`https://mcp.slack.com/mcp`) is left out: it needs a pre-registered Slack app with client id and secret and does not do dynamic client registration, so the plain `claude mcp add` path does not work. Add it once the app has a way to carry app credentials.
