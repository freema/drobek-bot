# The bot folder format

A bot is a folder under `./bots`. The folder holds everything that defines the bot: who it is and how it behaves (`BOT.md`), what it runs on and what it may touch (`bot.yaml`), the procedures it knows (`skills/`), and its own working notes (`memory/`). The app reads the folder, checks it, and turns it into a Claude Code project inside the bot's box. Nothing in the folder is a secret, ever.

`pnpm --filter @drobek-bot/bot-format validate <dir>` checks a folder and prints either a one-line summary or every problem as `file:line message`. The reference bot in `packages/bot-format/fixtures/inbox-briefing` uses every part of the format and is the example below.

## The folder

```
bots/inbox-briefing/
├── BOT.md                 identity and system prompt
├── bot.yaml               runtime, tools, routines, budget, policy
├── skills/
│   └── briefing/
│       └── SKILL.md       one skill per folder
└── memory/                the bot's own working state (git-ignored)
    ├── progress.md
    └── tasks/
```

The folder name is the bot's slug: lowercase letters, digits and single hyphens, 1 to 64 characters, not starting or ending with a hyphen. It is not repeated inside the files. Skill folders follow the same rule.

## BOT.md

YAML frontmatter with exactly three keys, then a Markdown body.

| Key        | Meaning                                                                             |
| ---------- | ----------------------------------------------------------------------------------- |
| `name`     | Display name, shown in the UI and at the top of the system prompt.                  |
| `job`      | One sentence: what the bot is for.                                                  |
| `language` | The language the bot speaks to the person: a short tag such as `cs`, `en`, `pt-BR`. |

Any other key is an error. The body becomes the system prompt and must not be empty. These sections are recommended (the loader does not check them):

- **Identity**: who the bot is and what it does every day.
- **Hard rules**: what it never does.
- **Gates**: what needs the person's approval, in prose for the model. Enforcement is `policy` in `bot.yaml`; the prose tells the model why it will be asked.
- **Tool preferences**: the order to try things in. The house order is MCP, then a CLI, then `curl`, then a script.
- **Output**: what a good result looks like.

```markdown
---
name: Inbox briefing
job: Turns the morning inbox and the open review requests into one short briefing the person can act on.
language: cs
---

## Identity

You are the inbox briefing bot. Every weekday morning you read what arrived ...

## Hard rules

- Never send, reply, forward, archive or delete anything. You read and you summarise.
  ...
```

The definition is written in English; `language` is what the bot speaks to the person.

## bot.yaml

Strict: an unknown key is an error, so a typo cannot silently disable a section. Only `version` and `model` are required.

| Key        | Type                                         | Default    | Meaning                                                                                                                                  |
| ---------- | -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `version`  | `1`                                          | required   | Format version.                                                                                                                          |
| `model`    | string                                       | required   | The model the box is pinned to, e.g. `claude-haiku-4-5`. Written to `.claude/settings.json` in the box.                                  |
| `auth`     | `subscription` or `api_key`                  | unset      | How the box authenticates. With `api_key` the key is injected per run; with `subscription` the person signs in inside the box once.      |
| `browser`  | `host-cdp`, `none` or `box`                  | `host-cdp` | `host-cdp` drives the host's own Chrome over CDP; `none` gives the bot no browser; `box` is reserved for a browser installed in the box. |
| `requires` | list of strings                              | `[]`       | Tools the bot expects in the box (`python3`, `jq`). Nothing is installed for it; the app reports what is missing.                        |
| `mcp`      | map of name to entry                         | `{}`       | MCP servers, see below. The name becomes the tool prefix `mcp__<name>__<tool>`.                                                          |
| `routines` | list                                         | `[]`       | Scheduled prompts, see below.                                                                                                            |
| `budget`   | `{ per_run_usd?, per_day_usd? }`             | unset      | Spending caps as non-negative numbers in USD; the host stops a run that crosses one, and zero blocks every run.                          |
| `policy`   | `{ approvals: { require?, allow?, deny? } }` | unset      | Which tools ask, run, or never run, see below.                                                                                           |
| `channels` | object                                       | unset      | Reserved for channels (chat integrations); any object is accepted for now.                                                               |

### mcp

Each entry is one of three shapes:

```yaml
mcp:
  github: # from the catalog, by id
    catalog: github
  mail-archive: # a local server the box starts on stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/bot/work/archive"]
    env: # optional; use ${VAR} for anything secret, never the value
      ARCHIVE_TOKEN: ${ARCHIVE_TOKEN}
  tracker: # a remote server
    url: https://example.com/mcp
    type: http # or sse; http when omitted
```

A `catalog` id that the catalog does not know is an error. Claude Code expands `${VAR}` in `.mcp.json` from the box's environment, which is how a token reaches a server without being written into the bot folder.

### routines

```yaml
routines:
  - name: weekday-briefing
    cron: "30 7 * * 1-5"
    timezone: Europe/Prague # default
    prompt: Prepare this morning's briefing following the briefing skill.
```

`cron` has five fields (minute, hour, day of month, month, day of week). Each field is `*`, a number, a range `a-b`, a step `*/n` or `a-b/n`, or a comma-separated list of those. Numbers must fit the field: 0-59, 0-23, 1-31, 1-12, 0-7 (0 and 7 are Sunday). Names such as `MON` and macros such as `@daily` are not accepted. Routine names must be unique within a bot. `timezone` is an IANA zone name.

### budget

```yaml
budget:
  per_run_usd: 0.25
  per_day_usd: 1
```

Both values are non-negative numbers in USD. The host stops a run the moment it crosses the per-run cap and starts none once the day's cap is reached; zero is a legitimate cap that blocks every run.

### policy

```yaml
policy:
  approvals:
    deny: [mcp__github__delete_*]
    require: [Bash, WebFetch, mcp__github__create_*]
    allow: [Read, Glob, Grep, mcp__github__get_*, mcp__github__list_*]
```

A pattern is an exact tool name (`Bash`, `mcp__github__get_issue`), a prefix followed by `*` (`mcp__github__*`), or `*` alone. When more than one list matches a tool, `deny` wins over `require`, and `require` over `allow`. A tool no list matches is left to the approval broker, which asks the person. Claude Code tool names look like `Bash`, `Read`, `Write`, `Edit`, `WebFetch`, and `mcp__<server>__<tool>` for MCP tools.

## skills/<name>/SKILL.md

One folder per skill, named by the slug rule, with a `SKILL.md` whose frontmatter `name` equals the folder name. The file is copied into the box verbatim as `.claude/skills/<name>/SKILL.md`, so anything Claude Code accepts in a skill works here.

| Field           | Required | Notes                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------- |
| `name`          | yes      | Must equal the folder name.                                                  |
| `description`   | yes      | What the skill does and when to use it; up to 1024 characters.               |
| `allowed-tools` | no       | Tools pre-approved while the skill runs: a space-separated string or a list. |
| `license`       | no       | Free text.                                                                   |
| `compatibility` | no       | Environment requirements, up to 500 characters.                              |
| `metadata`      | no       | A map for your own tooling.                                                  |

Other keys Claude Code documents (`disable-model-invocation`, `user-invocable`, `context`, `model`, `paths`, ...) pass through unchanged. Skill folders may hold supporting files next to `SKILL.md`; the loader does not read them.

```markdown
---
name: briefing
description: Writes the morning inbox briefing. Use when asked for a briefing, a summary of the inbox, or what needs an answer today.
allowed-tools: Read Glob Grep
---

# Morning briefing

1. Read yesterday's briefing ...
```

## memory/

The bot's own working state: `progress.md` and `tasks/*.md` by convention. Nothing in it is parsed; the loader only reports whether the folder exists and where it is. Under `./bots` it is git-ignored, because it is what the bot writes, not what defines it.

## What the box gets

The loader maps the folder onto a Claude Code project in the bot's working directory inside the box:

| Bot folder               | Box project                      | How                                                                                                               |
| ------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `BOT.md`                 | `CLAUDE.md`                      | A header built from `name`, `job` and `language`, then the body verbatim.                                         |
| `bot.yaml` `model`       | `.claude/settings.json`          | `{ "model": "<model>" }`. This is the one place a model pin takes effect for the CLI behind the ACP adapter.      |
| `bot.yaml` `mcp`         | `.mcp.json`                      | `{ "mcpServers": { ... } }` in Claude Code's shape, catalog references expanded; omitted when there is no server. |
| `skills/<name>/SKILL.md` | `.claude/skills/<name>/SKILL.md` | Verbatim.                                                                                                         |
| `memory/`                | (not copied)                     | The bot's home volume keeps its own state.                                                                        |

The shapes written are the ones Claude Code documents for [`.mcp.json`](https://code.claude.com/docs/en/mcp), [settings](https://code.claude.com/docs/en/settings) and [skills](https://code.claude.com/docs/en/skills), and the skill frontmatter follows the [Agent Skills specification](https://agentskills.io/specification):

```json
{
  "mcpServers": {
    "github": { "type": "http", "url": "https://api.githubcopilot.com/mcp/" },
    "mail-archive": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/bot/work/archive"]
    }
  }
}
```

```json
{ "model": "claude-haiku-4-5" }
```

`policy` is not written into the box: the approval broker enforces it from the outside, so a bot cannot loosen its own gates by editing a file. `requires`, `routines`, `budget` and `browser` are read by the app, not by Claude Code.

## The secret rule

The loader rejects the folder when any file it reads contains something shaped like a credential:

- `sk-ant-` followed by key characters (Anthropic API keys) and `sk-` followed by 20 or more key characters
- `ghp_` and `github_pat_` tokens
- `glpat-` tokens
- `AKIA` followed by 16 uppercase letters or digits (AWS access key ids)
- `xoxb-` and `xoxp-` tokens
- `-----BEGIN ... PRIVATE KEY-----`

The report names the file, the line and the kind, never the value. Secrets belong in the app's secret store and reach the box as environment variables for one run; in bot files, refer to them as `${NAME}`.

## The MCP catalog

`catalog/mcp.json` at the repository root lists MCP servers that were checked against the vendor's own documentation. A bot refers to one with `catalog: <id>` and gets the server's transport and address without repeating them. Each entry has `id`, `name`, `transport` (`http`, `sse` or `stdio`), `url` for a remote server or `command` and `args` for a local one, `auth` (`oauth`, `token` or `none`), `docs` (the vendor's page) and optional `notes`.

Remote servers are preferred: they need no install and the sign-in happens in the person's browser. A local server is listed only when `npx` can run it inside the box. To add an entry, verify the address and the sign-in method on the vendor's page, add the object, and run the tests: the catalog is validated against its schema on every run.

## Converting an existing Claude Code project

Most of a Claude Code project already has a place in the format:

| In the project                                       | In the bot folder                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                          | `BOT.md`: add the three-key frontmatter, keep the text as the body.                                                                                                    |
| `.claude/commands/*.md`                              | `skills/<name>/SKILL.md`: one folder per command; add `name` and `description`.                                                                                        |
| `.claude/skills/<name>/`                             | `skills/<name>/`: copy as is.                                                                                                                                          |
| `docs/progress.md`, `tasks/*.md`                     | `memory/progress.md`, `memory/tasks/*.md`.                                                                                                                             |
| `.claude/settings.json` `permissions.allow` / `deny` | `policy.approvals.allow` / `deny`: keep the tool names, drop the argument part (`Bash(npm run *)` becomes `Bash`), and put anything that needs a look under `require`. |
| `.claude/settings.json` `model`                      | `bot.yaml` `model`.                                                                                                                                                    |
| `.mcp.json`                                          | `bot.yaml` `mcp`: each `mcpServers` entry as is, or `catalog: <id>` where the catalog has it.                                                                          |
| `.env`, tokens in `.mcp.json` `env` or `headers`     | The secret store; `${NAME}` in the bot folder.                                                                                                                         |

Then run the validator.

## Validating

```sh
pnpm --filter @drobek-bot/bot-format validate bots/inbox-briefing
```

Exit 0 prints one line: slug, model, auth, browser, skills, routines, MCP servers, memory. Exit 1 prints every problem found, one per line, as `path:line message`, across all files at once. `--catalog <file>` points at a different catalog than `catalog/mcp.json`.
