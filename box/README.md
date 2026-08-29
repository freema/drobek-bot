# box — the bot computer

The image every bot runs in, plus the spike that proved the unmodified `claude`
CLI can be driven inside it from the host over ACP. The trust boundary is the
app (trusted) versus the box (untrusted); the host never enters the box's
transcript and the box never sees the host.

## What is in the image, and why it is thin

`box/Dockerfile`, built with `docker build -t drobek-bot-box box/`:

| Layer                                           | Why                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node:22-bookworm-slim`                         | Node for the ACP adapter and for MCP servers started with `npx`.                                                                                                                                                                    |
| `git`, `curl`, `ca-certificates` (apt)          | The tools a bot needs to touch repositories and HTTP endpoints.                                                                                                                                                                     |
| `gh` 2.98.0, `glab` 1.115.0                     | Release `.deb` packages, sha256-verified against the checksum files each project publishes with the release.                                                                                                                        |
| `@anthropic-ai/claude-code@2.1.251`             | The unmodified CLI. Since 2.1.x it is a native binary (`bin/claude.exe`, an ELF file, 204 MB), not a `cli.js`.                                                                                                                      |
| `@zed-industries/claude-code-acp@0.16.2`        | The ACP adapter: stdio JSON-RPC in, Claude Code out. It depends on `@anthropic-ai/claude-agent-sdk`, which bundles its own copy of the CLI (2.1.44, 77 MB); `CLAUDE_CODE_EXECUTABLE` points it at the pinned global binary instead. |
| `DISABLE_AUTOUPDATER=1`                         | The pinned CLI must not replace itself.                                                                                                                                                                                             |
| user `bot` (uid 1001), `WORKDIR /home/bot/work` | Non-root. `bypassPermissions` would not even be offered as root.                                                                                                                                                                    |
| `VOLUME /home/bot`                              | `~/.claude` (credentials, sessions, settings), `~/.claude.json`, the npx cache and anything a person installs by hand survive container restarts.                                                                                   |
| `CMD ["claude-code-acp"]`                       | `docker run -i` gives the host an ACP session on stdin/stdout.                                                                                                                                                                      |

Nothing else is bundled and nothing is auto-installed. The one runtime
download is the Playwright MCP server, fetched by `npx -y @playwright/mcp@0.0.79`
on first use into the home volume, because that is the shape of the `.mcp.json`
Claude Code reads. No Chromium: the browser is the host's own Chrome over CDP.

Measured size: 1.09 GB uncompressed (`docker images`), 270 MiB content
(`docker image inspect --format '{{.Size}}'`, the containerd store reports the
compressed content). The CLI binary is 204 MB of it and the adapter with its
bundled SDK copy another 123 MB.

## Two ways to authenticate

- **A. Subscription login inside the box** (a person does it, once): the CLI's
  own OAuth flow, credentials land in `~/.claude/.credentials.json` in the home
  volume. The app never sees or stores them. Commands are in the last section.
- **B. API key**: `-e ANTHROPIC_API_KEY` on `docker run` and nothing else.
  Verified: every probe below ran that way, with zero configuration in the box.
  The key travels through the docker CLI's environment, never argv, and the
  host redacts it from every event and log line as a last line of defence
  (`redactionsHit` in the run summary stayed 0 in all runs).

## The spike: `box/spike`

A private workspace package (`@drobek-bot/box-spike`) with the host side of
the experiment. TypeScript strict, run with `node --experimental-strip-types`.
Everything crossing a boundary is parsed: ACP messages by the SDK's types,
docker output and transcript lines by zod.

Pure, I/O-free modules (the ones tests cover):

- `src/policy.ts` — `decide(request, policy) -> "allow" | "deny"`, default
  deny, explicit allowlist (`Read` only unless a run names more), and the
  mapping of a decision onto the options the agent offered.
- `src/pricing.ts` — token accounting keyed by API message id, list prices by
  model, cost, and the cap check (`checkCap`). Unknown models are priced at the
  most expensive tier so the cap errs towards stopping.
- `src/transcript.ts` — the zod schema for Claude Code's transcript lines and
  where the transcript lives.
- `src/events.ts` — ACP session updates normalised to the NDJSON records the
  host prints; images are extracted separately so records stay small.
- `src/redact.ts` — secret redaction.

Plumbing: `src/docker.ts` (the only place `docker` is invoked), `src/acp-client.ts`
(ACP over the container's stdio via `@agentclientprotocol/sdk`), `src/run.ts`
(one run: start box, initialize, session, prompts, transcript tail, cap, kill,
summary), `src/probes/*` (entry points), `box-scripts/can-use-tool.mjs` (runs
inside the box).

### Running the probes

Prerequisites: Docker Desktop, the image built, `~/.config/drobek-bot/.env.test`
with `ANTHROPIC_API_KEY=...` (the test key; every run is Haiku, capped at $0.05).

```sh
pnpm --filter @drobek-bot/box-spike probe:acp          # spec 1, 2, 6, 7: events, API-key auth, model pin
pnpm --filter @drobek-bot/box-spike probe:permissions -- --decision deny   # spec 3
pnpm --filter @drobek-bot/box-spike probe:permissions -- --decision allow
pnpm --filter @drobek-bot/box-spike probe:sdk-hooks    # spec 3, fallback: canUseTool vs PreToolUse inside the box
pnpm --filter @drobek-bot/box-spike probe:browser      # spec 4: host Chrome over CDP (start Chrome first, see below)
pnpm --filter @drobek-bot/box-spike probe:resume       # spec 5: second prompt, then session/load in a new container
pnpm --filter @drobek-bot/box-spike probe:cap          # spec 7: cap at $0.001 must abort the run
pnpm --filter @drobek-bot/box-spike measure            # spec 6: the numbers as a table
```

Flags: `--cap <usd>` (default 0.05), `--max-turns <n>` (12), `--model <id>`
(`claude-haiku-4-5`), `--model-via option|env|settings` (default `settings`,
see findings), `--allow Tool,mcp__x__*` (policy allowlist), `--no-key` (rely on
the box's own login), `--out <dir>` (default `box/spike/out/<probe>-<time>/`).

Events go to stdout as NDJSON, one object per ACP update, plus `usage`,
`permission_request`, `memory`, `lifecycle` and a final `summary` record; the
same lines are written to `<out>/events.ndjson`, the adapter's stderr to
`<out>/box-stderr.log`, screenshots to `<out>/<toolCallId>-<n>.png`, and the
summary to `<out>/summary.json`. Probe exit code 0 means the probe's assertion
held.

For the browser probe, start a Chrome you own — never the user's profile — and
quit it afterwards:

```sh
open -na "Google Chrome" --args --remote-debugging-port=9222 \
  --user-data-dir=/tmp/drobek-spike-chrome --no-first-run --no-default-browser-check about:blank
curl localhost:9222/json/version   # must answer before the probe
```

## Findings

1. **Events out of the box.** Yes. Over stdio the host receives, as they
   happen: `tool_call` (with `_meta.claudeCode.toolName`, `kind`, `title`,
   `rawInput` — first with `{}` at `content_block_start`, then with the full
   input), `tool_call_update` (status, content, `rawOutput`),
   `agent_message_chunk` text deltas, `available_commands_update`, and the
   `session/prompt` response with `stopReason`. Thinking would arrive as
   `agent_thought_chunk` (none observed with Haiku on these prompts). What does
   **not** arrive: usage and cost. Adapter 0.16.2 drops the CLI's `result`
   message (`usage`, `total_cost_usd`, `modelUsage`) and never sends ACP's
   `usage_update`; `PromptResponse.usage` is absent. The host therefore tails
   the transcript the CLI writes in the box (`~/.claude/projects/-home-bot-work/<session>.jsonl`)
   with `docker exec tail -F`; every assistant line carries `message.usage`,
   `message.model` and the CLI `version`, and arrives while the turn is still
   running. That is also how the model and the CLI version are verified.
2. **API key.** `-e ANTHROPIC_API_KEY` is enough; nothing else configured.
3. **Permission gate.** See the table. Two classes of action never reach the
   gate, in the CLI's permission engine before `canUseTool` is consulted:
   read-only shell commands (`uname -a`, `find …`) and `Read` inside the
   working directory. `Read` outside it (`/etc/os-release`) does ask. The
   fallback experiment inside the box (`probe:sdk-hooks`, Agent SDK `query()`
   with both `canUseTool` and a `PreToolUse` hook) shows the hook sees every
   tool call and `canUseTool` only the escalated ones. A fail-closed gate for
   _everything_ therefore has to be a `PreToolUse` hook (which can return
   `permissionDecision: "deny"`), not the ACP permission request alone. The
   adapter already installs such a hook for settings-file rules but does not
   expose it over ACP.
   A `reject` makes the tool fail (the model sees "The user doesn't want to
   proceed…") **and aborts the turn**: the adapter answers `canUseTool` with
   `interrupt: true`, the CLI ends the query with an error result, and
   `session/prompt` fails with an internal error (`[ede_diagnostic] …`). The
   session stays usable; the next prompt works. No denied side effect
   happened (no directory, no file, `notes.txt` unchanged).
   The permission request carries `toolCallId`, `title`, `rawInput` and the
   three options (`allow_always`, `allow`, `reject`); the tool name and kind
   come from the preceding `tool_call` update with the same id.
4. **Host Chrome over CDP.** Works, with one correction to the plan: Chrome
   answers `Host header is specified and is not an IP address or localhost`
   to `http://host.docker.internal:9222`, so the endpoint must use the address
   the name resolves to inside the box (`192.168.65.254` on this Docker
   Desktop); the probes resolve it and write `.mcp.json` with
   `--cdp-endpoint http://<ip>:9222`. Chrome then also rewrites
   `webSocketDebuggerUrl` to that address. Project-scoped `.mcp.json` was
   loaded without any trust prompt; the model finds MCP tools through
   `ToolSearch` (no permission needed) and each MCP call asks. The screenshot
   arrived as a base64 `image/png` content block in `tool_call_update`
   (17,877 bytes) and was written to the run directory. The Playwright MCP
   server costs about 140-200 MiB of extra memory in the box.
5. **Session resume.** A second `session/prompt` on the same session recalled
   the code word. After killing the container and starting a new one on the
   same volume, `session/load` with the old id replayed the history as
   `user_message_chunk`/`agent_message_chunk` updates and the next prompt
   recalled it again ($0.0025 for the resumed turn).
6. **Numbers.** Below.
7. **Model pin and cap.** `_meta.claudeCode.options.model` on `session/new`
   and `ANTHROPIC_MODEL` in the box are both **ignored**: the adapter calls
   `setModel(models[0])` ("default") after start and the transcript shows
   `claude-opus-5`. What works is `"model": "claude-haiku-4-5"` in the
   project's `.claude/settings.json` (Claude Code's own setting, written into
   the volume before the run); the adapter matches it against the model list
   and the transcript shows `claude-haiku-4-5-20251001`. The host cap fires:
   with `--cap 0.001` the first usage line ($0.00615) exceeded it, the host
   sent `session/cancel`, the prompt returned `stopReason: "cancelled"` 20 ms
   later, and the container was killed (exit 137). `maxTurns` is passed
   through `_meta.claudeCode.options` (that part of the option bag does
   reach the SDK); `maxBudgetUsd` is available the same way but left off so
   the host is the enforcer. The host's price table is within 3.5% of the
   CLI's own `total_cost_usd` for the same usage ($0.02769 vs $0.02869).

### Permission requests by action (Haiku, `permissionMode: default`)

| Action                                          | Request seen | What it carried                                        | `reject`                                   | `allow`                    |
| ----------------------------------------------- | ------------ | ------------------------------------------------------ | ------------------------------------------ | -------------------------- |
| `Bash` read-only (`uname -a`, `find …`)         | **no**       | —                                                      | ran anyway                                 | ran                        |
| `Bash` with side effect (`mkdir … && echo > …`) | yes          | `command`, `description`                               | tool failed, turn aborted, nothing created | ran, file created          |
| `Bash` network (`curl -sS https://example.com`) | yes          | `command`, `description`                               | tool failed, turn aborted                  | ran, HTML returned         |
| `Write` new file                                | yes          | `file_path`, `content`                                 | tool failed, turn aborted, no file         | file created               |
| `Edit`                                          | yes          | `file_path`, `old_string`, `new_string`, `replace_all` | tool failed, turn aborted, file unchanged  | file edited                |
| `Read` inside cwd                               | **no**       | —                                                      | ran anyway                                 | ran                        |
| `Read` outside cwd (`/etc/os-release`)          | yes          | `file_path`                                            | (not exercised)                            | ran                        |
| `ToolSearch` (deferred MCP tool lookup)         | no           | —                                                      | ran                                        | ran                        |
| MCP `mcp__playwright__browser_navigate`         | yes          | `url`                                                  | tool failed, turn aborted                  | page opened in host Chrome |
| MCP `mcp__playwright__browser_take_screenshot`  | yes          | `scale`                                                | (not exercised)                            | PNG delivered in the event |

### Numbers (Apple Silicon, Docker Desktop, image `drobek-bot-box`)

| Measure                                                     | Value                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Image size                                                  | 1.09 GB uncompressed; 270 MiB content                             |
| `docker run` → ACP `initialize` response                    | 338 ms (197–373 ms across runs)                                   |
| `docker run` → `session/new` response (CLI up, MCP started) | 689 ms (420–984 ms; 984 on the first run of the day)              |
| `docker run` → first `session/update`                       | 696 ms                                                            |
| `session/prompt` → first agent event (tool call or text)    | 764 ms                                                            |
| Representative prompt duration (text + one `Read`)          | 2.6 s                                                             |
| Container memory, idle after `session/new`                  | 185 MiB (320–400 MiB with the Playwright MCP server running)      |
| Container memory, peak during the run                       | 196 MiB (360–550 MiB with Playwright MCP)                         |
| Tokens, representative run (Haiku)                          | input 18, output 219, cache read 37,830, cache write 2,916        |
| Cost, representative run                                    | $0.0085                                                           |
| Cap proof (`--cap 0.001`)                                   | aborted by host at $0.00615; prompt `cancelled`; container killed |
| Total spend of the spike (12 runs)                          | about $0.27, of which $0.087 were the two mis-pinned Opus 5 runs  |

## Human-only part

These need a person at the keyboard; the app never stores or proxies the
credentials involved.

(a) Subscription login inside the box (the CLI's OAuth flow: it prints a URL,
you open it on the host, sign in, and paste the code it shows back into the
box):

```sh
docker run -it --rm -v drobek-bot-box-home:/home/bot drobek-bot-box claude auth login
# or, inside an interactive session: docker run -it --rm -v drobek-bot-box-home:/home/bot drobek-bot-box claude
# then type /login
docker run --rm -v drobek-bot-box-home:/home/bot drobek-bot-box claude auth status
```

(b) Prove usage goes to the subscription: the same probe with **no** API key.
The events must still arrive and the summary must show `model.observed`; the
transcript will not carry API-key billing.

```sh
pnpm --filter @drobek-bot/box-spike probe:acp -- --no-key
```

(c) Check that `~/.claude` survived a container restart:

```sh
docker run --rm -v drobek-bot-box-home:/home/bot drobek-bot-box sh -c 'ls -la ~/.claude ~/.claude/.credentials.json && claude auth status'
```

(d) One request from the box to an internal host through the host's VPN
(Docker Desktop routes container traffic through the host's network stack;
fill in the URL):

```sh
docker run --rm drobek-bot-box curl -sS -o /dev/null -w '%{http_code}\n' https://INTERNAL-HOST.example.internal/
```
