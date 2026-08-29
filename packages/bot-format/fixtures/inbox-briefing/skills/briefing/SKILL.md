---
name: briefing
description: Writes the morning inbox briefing. Use when asked for a briefing, a summary of the inbox, or what needs an answer today.
allowed-tools: Read Glob Grep
---

# Morning briefing

1. Read yesterday's briefing in `memory/briefings/` and the open items in `memory/progress.md`, so nothing is reported twice.
2. Open the webmail tab in the browser and read every message that arrived since the last briefing. Do not open attachments.
3. List the pull requests waiting for the person's review through the `github` server (`list_*` and `search_*` tools only).
4. Sort into three groups: needs an answer today, waiting on others, can be ignored.
5. Write `memory/briefings/<YYYY-MM-DD>.md` with at most 15 lines and a link per item, then update `memory/progress.md`.

Never send, reply or archive. If something looks urgent, say so at the top of the briefing; the person decides.
