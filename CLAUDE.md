@AGENTS.md

## Implementation loop (implement-spec)

- linear_team: Nsoft
- linear_project: Drobek Bot
- linear_language: cs            # issues and comments are Czech; code, commits, PRs, docs are English
- owner: grasl.t@centrum.cz      # Tomáš — blocked issues are handed back to him
- gate: task verify              # typecheck + lint + tests, real exit code
- dev: task dev                  # local stack (docker compose)
- local_url: http://localhost:3050
- health: /api/health            # must report the running version
- release: none                  # no deploy pipeline yet; merge only
- release_policy: none
- merge: gh pr merge --squash --delete-branch --auto
- e2e: chrome-devtools           # blind e2e pass uses the Chrome DevTools MCP from .mcp.json
- e2e_login: none                # single-user local install, no login
- confirm_before_editing:        # fully autonomous — nothing listed
- independent_review: none
- progress_file: docs/progress.md

Project hard rules for the loop live in AGENTS.md ("Implementation loop specifics"). The Linear connector must be enabled in the session (`/mcp`); it is a claude.ai connector, not a local server.

## Development MCP servers

`.mcp.json` registers the local servers used while developing: `chrome-devtools` (e2e passes, debugging the web UI) and `playwright` (browser automation the product itself relies on). They start on demand via `npx`; `.claude/settings.json` enables them without prompting.
