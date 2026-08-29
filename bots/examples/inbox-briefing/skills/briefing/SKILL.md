---
name: briefing
description: Writes the morning inbox briefing from the webmail tab in the person's browser. Use when asked for a briefing, a summary of the inbox, or what needs an answer today.
---

# Morning inbox briefing

## Phase 1: what is already known

1. Read `memory/progress.md` for the date of the last briefing and the items still open.
2. Read the newest file in `memory/briefings/` so nothing is reported twice; an item reported before is mentioned again only when something changed.

## Phase 2: read the inbox

3. `browser_tabs` (list) and pick the tab whose title or URL is the webmail. If there is none, or the page shows a sign-in form, stop: write a one-line briefing saying the webmail is not open and finish.
4. `browser_snapshot` the message list. Work from the list and the preview pane; open a message with `browser_click` only when the preview does not show what is asked and by when.
5. Cover every message that arrived since the last briefing. Newsletters and notifications the person has ignored before (they are listed in `memory/progress.md`) are counted in one line, not read.
6. Never type, never press a key in the mailbox, never touch a reply, forward, archive or delete control. Opening a message is the only interaction.

## Phase 3: write

7. Sort into three groups: needs an answer today, waiting on others, can be ignored. Within a group, closest deadline first.
8. Write `memory/briefings/<YYYY-MM-DD>.md` in the format below, then rewrite `memory/progress.md` with today's date and the items still open.

## Stop conditions

- The webmail tab is missing or not signed in: one-line briefing, stop.
- A page does not load or a snapshot fails twice in a row: report it in the last line and continue with what you have.
- More than 60 new messages: briefing from the list only, no message opened, and say so.

## Output format

```markdown
# Inbox briefing <YYYY-MM-DD>

## Needs an answer today

- <sender>: <subject> — <what they want>, by <when> (<link to the message>)

## Waiting on others

- <sender>: <subject> — <what you are waiting for>

## Can be ignored

- <n> newsletters and notifications

Could not read: <nothing | what and why>
```

At most 15 lines under the heading. Never a credential, a code or a link from inside a message; link to the message itself.
