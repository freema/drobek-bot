# Install drobek bot with your AI agent

Copy everything below the line into Claude Code, Codex, Cursor or any agent that can run shell commands on your computer. It installs the current pre-alpha stack (no bot runs yet) and reports the health check back to you.

---

Install drobek bot on my computer. Work through the steps in order, run each command yourself, show me the output of every check, and stop and tell me if a step fails instead of working around it.

1. Check the prerequisites: `docker --version` and `docker compose version` must both work, and `docker info` must reach a running daemon. If Docker is missing or not running, tell me how to install or start Docker Desktop (or Docker Engine with the Compose plugin) for my operating system and stop there. Node, pnpm and Task are not needed.
2. Clone the repository into the current directory and enter it: `git clone https://github.com/freema/drobek-bot.git && cd drobek-bot`. If the folder already exists, `cd` into it and run `git pull` instead.
3. Create the local configuration from the template: `cp .env.example .env`. Do not change anything in it yet.
4. Check that the ports the stack publishes are free: 3050 (web), 5450 (Postgres) and 6390 (Redis). If one is taken, open `.env` and change `WEB_PUBLISH`, `POSTGRES_PUBLISH` or `REDIS_PUBLISH` to a free port, and tell me what you changed.
5. Build and start the stack: `docker compose up -d --build --wait`. The first build takes a few minutes. The command returns when every service reports healthy; if it fails, show me `docker compose ps` and `docker compose logs --tail=100`.
6. Wait for the health endpoint: `curl -fsS http://localhost:3050/api/health` (use the `WEB_PUBLISH` port if you changed it). Retry every 5 seconds for up to 2 minutes. It answers 200 with JSON when every check is ok, and 503 while something is still starting.
7. Open `http://localhost:3050` in my browser (again with the port from `.env` if you changed it).
8. Report back: the health JSON exactly as returned, the URL I should use, and the folder the repository lives in. Then tell me that `docker compose down` stops the stack and keeps its data, and `docker compose down -v` wipes it.

Do not install anything else, do not edit any file other than `.env`, and do not commit anything.
