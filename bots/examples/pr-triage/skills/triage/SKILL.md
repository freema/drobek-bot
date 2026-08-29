---
name: triage
description: Runs new and updated pull requests through the triage checklist (size, description, failing checks) and proposes labels and at most one comment per pull request. Use on the triage routine or when asked to triage pull requests.
---

# Pull request triage

## Phase 1: find the work

1. Read `memory/progress.md`: the repositories to watch and the pull requests already triaged, with the head commit each was triaged at.
2. For each repository, `list_pull_requests` with `state: open`, sorted by `updated`. A pull request is work when it is not in the progress file or its head commit changed since it was triaged. Skip drafts and pull requests opened by bots.

## Phase 2: the checklist

3. `pull_request_read` with `method: get`, `get_files` and `get_status` for each pull request that is work, then:

| Check       | Rule                                                              | Label               | Comment                                                           |
| ----------- | ----------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| Size        | more than 400 changed lines or more than 20 files                 | `size/large`        | none                                                              |
| Size        | 400 changed lines or fewer                                        | `size/small`        | none                                                              |
| Description | body empty or under 30 characters, or no line saying what and why | `needs-description` | one comment asking for what changed, why, and how it was verified |
| Checks      | at least one check failing or errored                             | `ci-failing`        | one comment naming the failing check                              |
| Checks      | checks still pending                                              | none                | none; look again next run                                         |

4. A pull request gets every label that applies and at most one comment; when both the description and the checks fail, one comment covers both.

## Phase 3: apply, with approval

5. For each pull request, propose the labels through `issue_write` (labels only, never state, title or body) and the comment through `add_issue_comment`. Each call asks; say in one line what you are about to send before you call.
6. A label the repository does not have: never create it silently. `label_write` asks; if the person denies, mention the missing label in the run report instead.
7. Append the run report to `memory/runs/<YYYY-MM-DD>.md` and rewrite `memory/progress.md` with the head commit of every pull request triaged.

## Stop conditions

- No repositories in `memory/progress.md`: report it and stop; the person fills the list in.
- A pull request already carries a triage comment from you: labels only, never a second comment for the same finding.
- More than 30 pull requests to triage in one run: the 30 most recently updated, and say how many wait.
- The person denies something on a pull request: skip the rest of that pull request, continue with the next one.

## Output format

```markdown
# Triage <YYYY-MM-DD> <HH:MM>

- <owner/repo>#<n> <title>: <labels> — comment: <yes/no> — <findings>

Nothing to say: #<n>, #<n>
Waiting: <count> more
```
