# AGENTS.md — how work is done in this repository

This file is the contract for every agent and contributor working on drobek bot. `CLAUDE.md` includes it.

## What we are building

drobek bot is an open-source, self-hosted app for AI teammates: named bots, each with its own isolated container (files, shell, browser access), skills (SKILL.md), routines (cron/event) and enforced approvals. Every action that leaves the box asks the human first (Allow once / Always allow / Deny). Secrets never enter the transcript. Everything a bot does is audited. It runs on the user's own machine with `docker compose`; the same stack runs on a server.

The first user is the maintainer, automating his own daily work (issue trackers, git hosting, error monitoring, email briefings). The first surface is a web chat on localhost.

## Keep it thin

Prefer the simplest mechanism that already exists. Concretely:

- The worker talks to Docker through `/var/run/docker.sock` and starts bot containers directly. The trust boundary is the app (trusted) vs. the boxes (untrusted), never app vs. host — say so plainly in the security docs.
- The box image is thin: Node, the unmodified `claude` CLI, git, `gh`, `glab`, curl. Nothing else is bundled and **nothing is auto-installed**. A bot may declare the tools it expects (`requires`); the app reports what is missing and offers a terminal into the box; the person installs it themselves and it persists in the bot's volume.
- The browser on a local install is the host's own Chrome over CDP. No bundled Chromium.
- MCP servers are configured the way Claude Code does it (`.mcp.json` in the box). We ship a catalog of known servers and run the equivalent of `claude mcp add`; nothing more.
- Networking is whatever the host has. No proxies, no egress policy in the walking skeleton.
- The `claude` binary is never modified and users sign in themselves, inside the box. The app never stores or proxies Claude.ai credentials. API keys are the first-class path.

If you are about to add a layer (a supervisor, a pack system, a custom protocol, a marketplace), stop and ask.

## Language

English everywhere: code, comments, commit messages, branch names, PR titles and bodies, docs, READMEs, issue templates, UI source strings. Other languages live only in i18n catalogs.

## No tracker references

Do not reference issue trackers or their IDs anywhere in this repository — not in code, comments, commits, branch names, PRs or docs. Describe the change and the reason in plain words. Planning lives outside the repo.

## Roles and models

- **Implementation, refactoring, architecture:** Fable / Opus.
- **Every test — unit, integration, e2e, visual snapshots, conformance suites — and the final verification on a clean install:** always **Sonnet**, run as a separate agent that receives only the spec and acceptance criteria, never the implementation diff. The agent that wrote the code never produces the evidence that it works.
- **Bots under test (e2e, CI):** the cheapest available Haiku, via a dedicated test API key, with a hard cost cap per run. Tests must never be a reason to fear running them.

## Commits and PRs

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), small diffs — "smallest possible diff, then make it smaller" — DCO sign-off. A PR states what changed, why, and how it was verified with an observable assertion, not "should work". Branch names describe the change (`feat/approval-broker`).

## TypeScript

Strict mode. No `any`, no `as` casts. zod at every boundary (HTTP, files, subprocess output). `packages/contracts` is the only place a type exists twice (schema + inferred type).

## Architecture rules

Frontends express intent and render state; the backend owns orchestration, authorization, validation, retries and recovery. Vendor SDKs live only in adapters (`runtime-*`, `computer-*`, `channel-*`); `packages/core` has no I/O. No hosted vendor is required to run the product.

## Security rules

Secrets are never logged and never appear in events or transcripts (guard + canary test). Boxes receive an allow-listed environment only. The approvals broker is fail-closed: unavailable means deny.

## Tests

- `pnpm test` — offline unit + conformance with the fake agent and fake computer from `packages/testkit` (every PR)
- `pnpm test:integration` — Testcontainers Postgres/Redis
- `pnpm test:e2e` — Playwright scenario against a running compose, bot on Haiku (nightly and on demand)
- `pnpm test:canary` — other runtimes

Fake drivers, not module mocking.

## UI

Everything comes from `packages/ui` (tokens generated from `docs/DESIGN.md`); no colours, fonts or spacing outside tokens. Light and dark always. Icons: Lucide plus the glyphs in DESIGN.md — never emoji.

## Planned layout

```
apps/web · apps/api · apps/worker
packages/contracts · core · db · runtime-acp · computer-docker · bot-format · guide · ui · sdk · testkit · channels
box/ (bot computer image) · bots/ (example bots; user bots are bind-mounted) · docs/ · tests/e2e
```

## Implementation loop specifics

Work on this repository is driven by the `implement-spec` loop (config block in `CLAUDE.md`, state in `docs/progress.md`). These project rules take precedence over the loop's defaults:

- **Branch names describe the change and carry no tracker ID** — `feat/approval-broker`, `fix/sse-replay` — even when the tracker suggests a branch name. Commit messages, PR titles and bodies and `docs/progress.md` refer to work by what it does, never by an ID. The one place a tracker is named in this repo is the loop's config block in `CLAUDE.md`.
- **Tests are written by a Sonnet agent, not by the implementer.** The implementer writes production code (and only the smallest smoke needed to run it). Before verification the orchestrator spawns a Sonnet agent that receives the acceptance criteria and the public interfaces — never the diff — and writes the unit/integration tests for the issue; they are committed on the same branch and are part of the gate. The blind e2e pass is a further, separate Sonnet agent. Test integrity is absolute: a red test is a finding, never something to weaken.
- **Bots under test run on Haiku** through the test API key in `~/.config/drobek-bot/.env.test`, with a hard cost cap per run. Never a production key, never a subscription login in CI.
- **Thin by default** (see "Keep it thin"). An issue that seems to need a new layer is a design question for the owner, not an extra commit.
- `docs/progress.md` holds only working state: what is in flight (by title), failed approaches, open questions for the owner. Prune it as things land.
