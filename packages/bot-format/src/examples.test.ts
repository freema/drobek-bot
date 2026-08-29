import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpCatalog } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { formatIssue } from "./issues.js";
import { loadBot, loadCatalog } from "./load.js";
import { toClaudeProjectFiles } from "./project-files.js";

/**
 * The example bots in `bots/examples/` are product examples the person copies
 * into `./bots`, so every one of them must load against the shipped catalog,
 * map onto a box project, and carry both spending caps and a policy that
 * names what asks and what never runs.
 */

const EXAMPLES = fileURLToPath(new URL("../../../bots/examples", import.meta.url));
const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

const exampleDirs = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function loadShippedCatalog(): Promise<McpCatalog> {
  const catalog = await loadCatalog(CATALOG);
  if (!catalog.ok) throw new Error(catalog.issues.map(formatIssue).join("\n"));
  return catalog.value;
}

describe("bots/examples", () => {
  it("holds at least one example bot", () => {
    expect(exampleDirs.length).toBeGreaterThan(0);
  });

  for (const slug of exampleDirs) {
    describe(slug, () => {
      it("loads against the shipped catalog and maps onto the box project", async () => {
        const catalog = await loadShippedCatalog();
        const bot = await loadBot(path.join(EXAMPLES, slug), { catalog });
        if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));

        expect(bot.value.slug).toBe(slug);
        const files = toClaudeProjectFiles(bot.value).map((file) => file.path);
        expect(files).toContain("CLAUDE.md");
        expect(files).toContain(".claude/settings.json");
        expect(files.some((file) => file.startsWith(".claude/skills/"))).toBe(true);
      });

      it("caps spending per run and per day", async () => {
        const catalog = await loadShippedCatalog();
        const bot = await loadBot(path.join(EXAMPLES, slug), { catalog });
        if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));

        expect(bot.value.manifest.budget?.per_run_usd).toBeTypeOf("number");
        expect(bot.value.manifest.budget?.per_day_usd).toBeTypeOf("number");
      });

      it("names tools that ask and tools that never run", async () => {
        const catalog = await loadShippedCatalog();
        const bot = await loadBot(path.join(EXAMPLES, slug), { catalog });
        if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));

        const approvals = bot.value.manifest.policy?.approvals;
        expect(approvals?.deny?.length ?? 0).toBeGreaterThan(0);
        expect(approvals?.require?.length ?? 0).toBeGreaterThan(0);
        expect(approvals?.allow?.length ?? 0).toBeGreaterThan(0);
      });
    });
  }
});
