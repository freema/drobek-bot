import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { McpCatalog } from "@drobek-bot/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { formatIssue } from "./issues.js";
import { BOT_MD, BOT_YAML, loadBot, loadCatalog, SKILLS_DIR, SKILL_MD } from "./load.js";
import { toClaudeProjectFiles } from "./project-files.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/inbox-briefing", import.meta.url));
const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

async function loadFixtureCatalog(): Promise<McpCatalog> {
  const catalog = await loadCatalog(CATALOG);
  if (!catalog.ok) throw new Error(catalog.issues.map(formatIssue).join("\n"));
  return catalog.value;
}

describe("the reference bot", () => {
  it("loads and maps onto the box project files", async () => {
    const catalog = await loadFixtureCatalog();

    const bot = await loadBot(FIXTURE, { catalog });
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

  it("reports one skill, one routine, two mcp servers and memory present", async () => {
    const catalog = await loadFixtureCatalog();
    const bot = await loadBot(FIXTURE, { catalog });
    if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));

    expect(bot.value.skills).toHaveLength(1);
    expect(bot.value.skills[0]?.name).toBe("briefing");
    expect(bot.value.manifest.routines).toHaveLength(1);
    expect(bot.value.manifest.routines[0]?.name).toBe("weekday-briefing");
    expect(Object.keys(bot.value.mcp)).toHaveLength(2);
    expect(bot.value.memory.exists).toBe(true);
    expect(bot.value.memory.path).toBe(path.join(FIXTURE, "memory"));
  });
});

describe("loadBot: broken bot folders", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    }
  });

  async function copyFixtureInto(parentName: string): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "bot-format-"));
    tempDirs.push(root);
    const dir = path.join(root, parentName);
    await cp(FIXTURE, dir, { recursive: true });
    return dir;
  }

  it("fails naming the file when BOT.md is missing", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    await unlink(path.join(dir, BOT_MD));

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.file === BOT_MD && issue.message === "missing"),
    ).toBe(true);
  });

  it("loads with memory reported absent when memory/ does not exist", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    await rm(path.join(dir, "memory"), { recursive: true, force: true });

    const result = await loadBot(dir, { catalog });
    if (!result.ok) throw new Error(result.issues.map(formatIssue).join("\n"));
    expect(result.value.memory.exists).toBe(false);
  });

  it("fails when a skill's frontmatter name does not equal its folder name", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    const skillFile = path.join(dir, SKILLS_DIR, "briefing", SKILL_MD);
    const skillText = await readFile(skillFile, "utf8");
    await writeFile(skillFile, skillText.replace("name: briefing", "name: other"));

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((candidate) => candidate.file?.endsWith(SKILL_MD));
    expect(issue?.message).toContain('must equal the folder name "briefing"');
  });

  it("fails when the folder name is not a valid slug", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("Not A Valid Slug");

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.message.includes("is not a valid slug"))).toBe(true);
  });

  it("fails naming the file and line when BOT.md contains a secret-shaped string", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    const botMdFile = path.join(dir, BOT_MD);
    const original = await readFile(botMdFile, "utf8");
    await writeFile(botMdFile, `${original}\nLeaked: sk-ant-abcdefgh12345\n`);

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((candidate) => candidate.file === BOT_MD);
    expect(issue).toBeDefined();
    expect(issue?.line).toBeDefined();
    expect(issue?.message).toContain("anthropic-api-key");
  });

  it("fails naming the file and line when bot.yaml contains a secret-shaped string", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    const manifestFile = path.join(dir, BOT_YAML);
    const original = await readFile(manifestFile, "utf8");
    await writeFile(manifestFile, `${original}\n# leaked: ghp_12345678\n`);

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((candidate) => candidate.file === BOT_YAML);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("github-token");
  });

  it("fails naming the file and line when a SKILL.md contains a secret-shaped string", async () => {
    const catalog = await loadFixtureCatalog();
    const dir = await copyFixtureInto("inbox-briefing");
    const skillFile = path.join(dir, SKILLS_DIR, "briefing", SKILL_MD);
    const original = await readFile(skillFile, "utf8");
    await writeFile(skillFile, `${original}\nLeaked: glpat-12345678\n`);

    const result = await loadBot(dir, { catalog });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((candidate) => candidate.file?.endsWith(SKILL_MD));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("gitlab-token");
  });
});
