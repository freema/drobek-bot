---
name: repo-briefing
description: Writes the morning GitHub briefing (failing pull requests, review requests, open issues) across the person's repositories, with proposed comments kept as drafts. Use when asked for a GitHub briefing, what needs review, or what is failing.
---

# Morning GitHub briefing

## Phase 1: what is already known

1. Read `memory/progress.md`: the date of the last briefing and the items already reported, with their state.
2. Read the newest file in `memory/briefings/`; an item reported before is repeated only when its state changed (a check went red, a review landed, a comment arrived).

## Phase 2: collect

3. `get_me` for the login, then through the `github` server:
   - review requests: `search_pull_requests` with `is:open review-requested:@me`
   - the person's open pull requests: `search_pull_requests` with `is:open author:@me`, then `get_pull_request_status` on each to find failing checks
   - issues: `search_issues` with `is:open is:issue assignee:@me`, and `is:open is:issue mentions:@me updated:>=<yesterday>`
4. If the server is not signed in or the calls fail, fall back to the `gh` CLI once: `gh search prs --review-requested=@me --state=open`, `gh search prs --author=@me --state=open`, `gh pr checks <number> --repo <owner/repo>`. Each command asks; say in the last line of the briefing that the fallback was used.
5. For each failing pull request, `get_job_logs` with `failed_only` (or `gh run view --log-failed`) and keep the one line that names the failing step. Do not paste logs.

## Phase 3: write

6. For an item that clearly needs a reply from the person (a question addressed to them, a review waiting more than two working days), draft one comment of at most three sentences under `## Drafts`. Do not post it.
7. Write `memory/briefings/<YYYY-MM-DD>.md` in the format below, then rewrite `memory/progress.md`.

## Stop conditions

- No session with the server and no `GH_TOKEN` in the environment: a one-line briefing saying so, stop.
- More than 50 items in a group: the 20 most recently updated and the count.
- The person asks you to post a draft: call `add_issue_comment` with that draft verbatim; the approval shows the text. Never post more than the person named.

## Output format

```markdown
# GitHub briefing <YYYY-MM-DD>

## Failing checks

- <owner/repo>#<n> <title> — <failing check> (<link>)

## Review requests

- <owner/repo>#<n> <title> — waiting <d> days (<link>)

## Issues

- <owner/repo>#<n> <title> — <why it is here> (<link>)

## Drafts

- for <owner/repo>#<n>: "<comment text>"

Since last time: <what changed>
```

At most 20 lines before `## Drafts`. If the `gh` fallback was used, the last line says so.
