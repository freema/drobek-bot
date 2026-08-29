---
name: watch
description: Checks Sentry for issues that are new or have regressed since the last run, groups them by cause and drafts an incident note. Use on the hourly routine or when asked what is breaking right now.
---

# Sentry watch

## Phase 1: scope

1. Read `memory/progress.md`: the projects to watch (every project of the organisation when the list is empty), the time of the last run and the incidents still open.
2. `find_organizations` and `find_projects` once per run; keep the slugs.

## Phase 2: collect

3. Through the `sentry` server, per project: `search_issues` with `is:unresolved firstSeen:-1h` for new issues and `is:unresolved is:regressed lastSeen:-1h` for regressions. When the last run is older than an hour, widen the window to cover it (`-2h`, `-6h`, ...). Ask for at most 50 per query, sorted by frequency.
4. `get_issue_details` for every issue that has 10 or more events, affects 3 or more users, or is a regression of an issue named in an open incident. Keep the culprit, the top in-app stack frame, the release and the counts; never the request body or the headers.
5. Group issues that share a culprit, a stack frame or a release. A group of one is still a group.

## Phase 3: write

6. Nothing found: say `<HH:MM>: nothing new` in the chat, update the last-run time in `memory/progress.md`, stop.
7. Otherwise write or extend `memory/incidents/<YYYY-MM-DD>.md` in the format below: one section per group, appended to the section that already covers the same cause when there is one. Rewrite `memory/progress.md` with the last-run time, the last issue seen per project and the open incidents.
8. Only when the person asks: `update_issue` to assign or resolve, `analyze_issue_with_seer` for a root-cause run. Both ask; name the issue and the change before you call.

## Stop conditions

- The server is not signed in or the organisation is not found: one line in the chat, do not touch the progress file, stop.
- More than 200 new issues in the window: treat it as one incident (`error volume`), list the ten most frequent, and say so at the top of the note.
- The per-run budget is nearly spent: write what you have, mark the note `incomplete`, stop.

## Output format

```markdown
# Incidents <YYYY-MM-DD>

## <HH:MM> <shared cause, one line>

- Issues: <link>, <link>
- First seen <time>, last seen <time>; <n> events, <m> users; release <version>
- Top frame: `<file>:<line> in <function>`
- Next step: <one sentence, such as roll back <version> or assign to the owner of <module>>
```

At most 40 lines per note. Link every issue; paste nothing beyond the message and the top frame.
