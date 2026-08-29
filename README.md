# drobek bot

**Open-source, self-hosted AI teammates. Your own Grok Bot, on your own machine.**

Named bots with their own isolated computer, skills and routines. Every action outside the box asks you first. Runs on your existing Claude subscription or any API key.

- **1 bot = 1 isolated container** — files, shell and browser access per bot, nothing shared
- **Enforced approvals, not prompts** — Allow once / Always allow / Deny on every action that leaves the box
- **Secrets never enter the transcript** — credentials are injected by a broker, the model never sees them
- **Full audit** — what every bot did, when, and who approved it

> Status: pre-alpha. Nothing runs yet — the walking skeleton is being built. Watch the repo.

## Quickstart (developers)

Requires Docker with Compose, Node 22, pnpm 10 and [Task](https://taskfile.dev).

```sh
git clone https://github.com/freema/drobek-bot.git
cd drobek-bot
cp .env.example .env
docker compose up -d --build --wait
```

Open <http://localhost:3050>: the page shows the api version, commit and the health checks, and `curl localhost:3050/api/health` returns the same as JSON. `task check` runs the gate (typecheck, lint, tests); `task dev`, `task stop`, `task reset` and `task logs` drive the stack.

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
