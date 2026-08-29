import path from "node:path";
import { fileURLToPath } from "node:url";

import { claudeMcpConfigSchema, type ClaudeMcpServer } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { formatIssue } from "./issues.js";
import { loadBot, loadCatalog } from "./load.js";
import {
  toClaudeMcpServers,
  toClaudeMd,
  toClaudeProjectFiles,
  type ClaudeProjectInput,
} from "./project-files.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/inbox-briefing", import.meta.url));
const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

async function loadFixtureBot(): Promise<ClaudeProjectInput> {
  const catalog = await loadCatalog(CATALOG);
  if (!catalog.ok) throw new Error(catalog.issues.map(formatIssue).join("\n"));
  const bot = await loadBot(FIXTURE, { catalog: catalog.value });
  if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));
  return bot.value;
}

describe("toClaudeMd", () => {
  it("headers the identity, then the system prompt body verbatim", () => {
    const content = toClaudeMd(
      { name: "Inbox briefing", job: "Turns mail into a briefing.", language: "cs" },
      "## Identity\n\nYou are the bot.",
    );
    expect(content).toBe(
      "# Inbox briefing\n\nJob: Turns mail into a briefing.\nLanguage: cs\n\n## Identity\n\nYou are the bot.\n",
    );
  });
});

describe("toClaudeMcpServers", () => {
  it("defaults a remote server's type to http when unset", () => {
    expect(toClaudeMcpServers({ svc: { url: "https://example.com/mcp" } })).toEqual({
      svc: { type: "http", url: "https://example.com/mcp" },
    });
  });

  it("keeps an explicit remote type", () => {
    expect(toClaudeMcpServers({ svc: { url: "https://example.com/mcp", type: "sse" } })).toEqual({
      svc: { type: "sse", url: "https://example.com/mcp" },
    });
  });

  it("preserves env on a stdio server", () => {
    expect(
      toClaudeMcpServers({
        svc: { command: "npx", env: { TOKEN: "secret-value-not-a-real-key" } },
      }),
    ).toEqual({ svc: { command: "npx", env: { TOKEN: "secret-value-not-a-real-key" } } });
  });

  it("preserves both args and env on a stdio server", () => {
    expect(
      toClaudeMcpServers({
        svc: { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "x" } },
      }),
    ).toEqual({ svc: { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "x" } } });
  });
});

describe("toClaudeProjectFiles: the reference bot", () => {
  it("writes CLAUDE.md with the identity header and the BOT.md body verbatim", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    const claudeMd = files.find((file) => file.path === "CLAUDE.md");
    expect(claudeMd).toBeDefined();
    expect(claudeMd?.content).toContain("# Inbox briefing");
    expect(claudeMd?.content).toContain(`Job: ${bot.identity.job}`);
    expect(claudeMd?.content).toContain(`Language: ${bot.identity.language}`);
    expect(claudeMd?.content).toContain(bot.systemPrompt);
  });

  it("writes the skill file verbatim", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    const skillFile = files.find((file) => file.path === ".claude/skills/briefing/SKILL.md");
    expect(skillFile?.content).toBe(bot.skills[0]?.text);
  });

  it("writes a .mcp.json that parses and validates against claudeMcpConfigSchema", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    const mcpFile = files.find((file) => file.path === ".mcp.json");
    expect(mcpFile).toBeDefined();
    const data: unknown = JSON.parse(mcpFile?.content ?? "");
    const parsed = claudeMcpConfigSchema.safeParse(data);
    expect(parsed.success, parsed.error?.message).toBe(true);
    if (!parsed.success) return;
    const servers = parsed.data.mcpServers;
    const mailArchive = servers["mail-archive"];
    if (mailArchive === undefined) throw new Error("mail-archive server missing from .mcp.json");
    expect("type" in mailArchive).toBe(false);
    expect(servers.github).toEqual({ type: "http", url: "https://api.githubcopilot.com/mcp/" });
  });

  it("writes .claude/settings.json with the manifest's model", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    const settings = files.find((file) => file.path === ".claude/settings.json");
    const data: unknown = JSON.parse(settings?.content ?? "");
    expect(data).toEqual({ model: bot.manifest.model });
  });

  it("pins a different model when the model option is given", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot, { model: "claude-3-5-haiku-latest" });
    const settings = files.find((file) => file.path === ".claude/settings.json");
    const data: unknown = JSON.parse(settings?.content ?? "");
    expect(data).toEqual({ model: "claude-3-5-haiku-latest" });
  });

  it("merges host-added mcpServers, which win over the bot's own on a name clash", async () => {
    const bot = await loadFixtureBot();
    const hostServers: Record<string, ClaudeMcpServer> = {
      browser: { type: "http", url: "http://host.local:9222" },
      "mail-archive": { type: "http", url: "https://host-wins.example.com" },
    };
    const files = toClaudeProjectFiles(bot, { mcpServers: hostServers });
    const mcpFile = files.find((file) => file.path === ".mcp.json");
    const data: unknown = JSON.parse(mcpFile?.content ?? "");
    const parsed = claudeMcpConfigSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.mcpServers.browser).toEqual({ type: "http", url: "http://host.local:9222" });
    expect(parsed.data.mcpServers["mail-archive"]).toEqual({
      type: "http",
      url: "https://host-wins.example.com",
    });
  });

  it("never puts the policy into any output file", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    for (const file of files) {
      expect(file.content).not.toContain("policy");
      expect(file.content).not.toContain("approvals");
      expect(file.content).not.toContain("mcp__github__delete_");
    }
  });

  it("never produces a path that escapes the project", async () => {
    const bot = await loadFixtureBot();
    const files = toClaudeProjectFiles(bot);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.path.includes("..")).toBe(false);
      expect(path.isAbsolute(file.path)).toBe(false);
    }
  });

  it("is deterministic: the same input produces identical output twice", async () => {
    const bot = await loadFixtureBot();
    expect(toClaudeProjectFiles(bot)).toEqual(toClaudeProjectFiles(bot));
  });
});
