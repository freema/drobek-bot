import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatIssue } from "./issues.js";
import { loadBot, loadCatalog } from "./load.js";
import { toClaudeProjectFiles } from "./project-files.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/inbox-briefing", import.meta.url));
const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

describe("the reference bot", () => {
  it("loads and maps onto the box project files", async () => {
    const catalog = await loadCatalog(CATALOG);
    if (!catalog.ok) throw new Error(catalog.issues.map(formatIssue).join("\n"));

    const bot = await loadBot(FIXTURE, { catalog: catalog.value });
    if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));

    expect(bot.value.slug).toBe("inbox-briefing");
    expect(Object.keys(bot.value.mcp)).toEqual(["github", "mail-archive"]);
    expect(toClaudeProjectFiles(bot.value).map((file) => file.path)).toEqual([
      "CLAUDE.md",
      ".claude/settings.json",
      ".claude/skills/briefing/SKILL.md",
      ".mcp.json",
    ]);
  });
});
