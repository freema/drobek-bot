---
name: standup
description: Writes the three-line standup draft (yesterday, today, blockers) from the person's commits, closed issues and open review requests on GitHub. Use on the morning routine or when asked for a standup.
---

# Standup draft

## Phase 1: the window

1. Read `memory/progress.md`: the last day covered and the blockers carried over. Yesterday runs from the end of the last day covered to now; on Monday, or after a day off, it spans the days in between and the draft says so.
2. `get_me` for the login. Dates are in `Europe/Prague`.

## Phase 2: collect, through the `github` server only

3. Done yesterday:
   - `search_pull_requests` with `author:@me is:merged merged:<window>` and with `author:@me is:closed closed:<window>`
   - `search_issues` with `is:issue assignee:@me is:closed closed:<window>`
   - `search_pull_requests` with `author:@me is:open updated:<window>`, then `list_commits` on each pull request's head branch with `author` and `since` for the commits pushed in the window
4. Today:
   - `search_pull_requests` with `is:open review-requested:@me`
   - the person's open pull requests whose `pull_request_read` with `method: get_status` reports a failing check
5. Blockers: a pull request of the person's waiting for review for more than two working days, a failing check older than a day, and whatever `memory/progress.md` carried over that still stands.

## Phase 3: write

6. Compress each group into one line of at most 160 characters: items separated by semicolons, each with its number in parentheses, the repository named only when more than one is involved.
7. Write `memory/standups/<YYYY-MM-DD>.md`, then rewrite `memory/progress.md` with today's date and the blockers still standing.
8. Only when the person asks you to post the draft somewhere: do it through the tool they name, verbatim. The call asks; never post on your own.

## Stop conditions

- The server is not signed in: one line in the chat, stop; do not write a draft.
- Nothing found for yesterday: `Yesterday: nothing on GitHub`; do not guess from elsewhere.
- More than 15 items in a group: the five most recent and `and <n> more`.

## Output format

```markdown
# Standup <YYYY-MM-DD>

Yesterday: <item> (<n>); <item> (<n>)
Today: <item> (<n>)
Blockers: none
```

Three lines under the heading, nothing else. Earlier drafts stay untouched.
