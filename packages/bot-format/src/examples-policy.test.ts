/**
 * Pins the safety invariants of the example bot gallery (`bots/examples/`)
 * against the product promise: read freely, write with approval, destroy
 * never.
 *
 * `examples.test.ts` already checks that each bot loads against the shipped
 * catalog and maps onto a box project. This file checks what its policy and
 * schedule actually decide: that every bot's core tools and every MCP
 * server it declares follow that promise, that routines run at hours a
 * person would expect, that every catalog reference, secret and required
 * CLI is real and documented, and that no example file carries anything
 * shaped like a secret or a real identity.
 */
import { readFileSync, readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_TIMEZONE, type ApprovalPolicy, type McpCatalog } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { formatIssue } from "./issues.js";
import { BOT_MD, BOT_YAML, SKILLS_DIR, SKILL_MD, loadBot, loadCatalog } from "./load.js";
import { parseManifest } from "./manifest.js";
import { decideApproval } from "./policy.js";
import { findSecretLikeStrings } from "./secrets.js";
import type { LoadedBot } from "./types.js";

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

async function loadExampleBot(slug: string): Promise<LoadedBot> {
  const catalog = await loadShippedCatalog();
  const bot = await loadBot(path.join(EXAMPLES, slug), { catalog });
  if (!bot.ok) throw new Error(bot.issues.map(formatIssue).join("\n"));
  return bot.value;
}

/** The bot's approvals policy. Fails loudly, per spec, when a bot ships with none. */
function approvalsOf(bot: LoadedBot, slug: string): ApprovalPolicy {
  const approvals = bot.manifest.policy?.approvals;
  if (approvals === undefined) {
    throw new Error(`${slug}: bot.yaml has no policy.approvals`);
  }
  return approvals;
}

/**
 * The MCP server names a bot declares, read synchronously so the result can
 * drive which per-server `it`s get registered — vitest collects `describe`
 * bodies synchronously, so this cannot come from the async `loadBot`.
 */
function declaredMcpServerNames(slug: string): string[] {
  const text = readFileSync(path.join(EXAMPLES, slug, BOT_YAML), "utf8");
  const manifest = parseManifest(text);
  if (!manifest.ok) throw new Error(manifest.issues.map(formatIssue).join("\n"));
  return Object.keys(manifest.value.mcp);
}

async function readSkillTexts(dir: string): Promise<string[]> {
  const skillsDir = path.join(dir, SKILLS_DIR);
  let names: string[];
  try {
    names = (await readdir(skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  return Promise.all(names.map((name) => readFile(path.join(skillsDir, name, SKILL_MD), "utf8")));
}

/** Every file under `dir`, recursively, as absolute paths. */
async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function decisionOrThrow(tool: string, approvals: ApprovalPolicy): string {
  const decision = decideApproval(tool, approvals);
  return decision === undefined ? "undefined" : decision;
}

describe("bots/examples: core tools follow read freely, write with approval, destroy never", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: Read, Glob and Grep are allowed`, async () => {
      const bot = await loadExampleBot(slug);
      const approvals = approvalsOf(bot, slug);
      for (const tool of ["Read", "Glob", "Grep"]) {
        expect(decideApproval(tool, approvals), `${slug}: ${tool}`).toBe("allow");
      }
    });

    it(`${slug}: Write, Edit, Bash and WebFetch ask or are denied, never allowed or unlisted`, async () => {
      const bot = await loadExampleBot(slug);
      const approvals = approvalsOf(bot, slug);
      for (const tool of ["Write", "Edit", "Bash", "WebFetch"]) {
        const decision = decisionOrThrow(tool, approvals);
        expect(
          decision === "require_approval" || decision === "deny",
          `${slug}: ${tool} decided "${decision}"`,
        ).toBe(true);
      }
    });
  }
});

describe("bots/examples: MCP servers deny the destructive tools, allow the read-only ones", () => {
  const READ_ONLY_TOOLS: Record<string, readonly string[]> = {
    github: [
      "mcp__github__list_issues",
      "mcp__github__get_pull_request",
      "mcp__github__search_issues",
    ],
    sentry: ["mcp__sentry__list_issues", "mcp__sentry__get_issue", "mcp__sentry__search_issues"],
  };

  const DENY_TOOLS: Record<string, readonly string[]> = {
    github: [
      "mcp__github__merge_pull_request",
      "mcp__github__delete_repository",
      "mcp__github__delete_workflow_run_logs",
    ],
    sentry: ["mcp__sentry__delete_issue"],
  };

  for (const slug of exampleDirs) {
    for (const serverName of declaredMcpServerNames(slug)) {
      const denyTools = DENY_TOOLS[serverName];
      const readOnlyTools = READ_ONLY_TOOLS[serverName];

      if (denyTools !== undefined) {
        it(`${slug}: destructive ${serverName} tools are denied`, async () => {
          const bot = await loadExampleBot(slug);
          const approvals = approvalsOf(bot, slug);
          for (const tool of denyTools) {
            expect(decideApproval(tool, approvals), `${slug}: ${tool}`).toBe("deny");
          }
        });
      }

      if (readOnlyTools !== undefined) {
        it(`${slug}: read-only ${serverName} tools are allowed`, async () => {
          const bot = await loadExampleBot(slug);
          const approvals = approvalsOf(bot, slug);
          for (const tool of readOnlyTools) {
            expect(decideApproval(tool, approvals), `${slug}: ${tool}`).toBe("allow");
          }
        });
      }
    }
  }

  it("github-briefing and pr-triage require approval before posting a comment (add_issue_comment)", async () => {
    for (const slug of ["github-briefing", "pr-triage"]) {
      const bot = await loadExampleBot(slug);
      const approvals = approvalsOf(bot, slug);
      expect(decideApproval("mcp__github__add_issue_comment", approvals), slug).toBe(
        "require_approval",
      );
    }
  });

  it("sentry-watch requires approval before update_issue", async () => {
    const bot = await loadExampleBot("sentry-watch");
    const approvals = approvalsOf(bot, "sentry-watch");
    expect(decideApproval("mcp__sentry__update_issue", approvals)).toBe("require_approval");
  });

  it("inbox-briefing: reading the browser (snapshot, screenshot) is allowed", async () => {
    const bot = await loadExampleBot("inbox-briefing");
    const approvals = approvalsOf(bot, "inbox-briefing");
    for (const tool of [
      "mcp__playwright__browser_snapshot",
      "mcp__playwright__browser_take_screenshot",
    ]) {
      expect(decideApproval(tool, approvals), tool).toBe("allow");
    }
  });

  it("inbox-briefing: typing and clicking in the browser ask or are denied, never allowed", async () => {
    const bot = await loadExampleBot("inbox-briefing");
    const approvals = approvalsOf(bot, "inbox-briefing");
    for (const tool of [
      "mcp__playwright__browser_click",
      "mcp__playwright__browser_type",
      "mcp__playwright__browser_fill_form",
    ]) {
      const decision = decisionOrThrow(tool, approvals);
      expect(
        decision === "require_approval" || decision === "deny",
        `${tool} decided "${decision}"`,
      ).toBe(true);
    }
  });

  it("inbox-briefing: navigating the browser asks or is allowed, never left unlisted", async () => {
    const bot = await loadExampleBot("inbox-briefing");
    const approvals = approvalsOf(bot, "inbox-briefing");
    const decision = decisionOrThrow("mcp__playwright__browser_navigate", approvals);
    expect(
      decision === "require_approval" || decision === "allow",
      `browser_navigate decided "${decision}"`,
    ).toBe(true);
  });
});

interface CronFields {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
}

function parseCronFields(cron: string): CronFields {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/);
  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    throw new Error(`cron "${cron}" does not have five fields`);
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** The day-of-week field expanded to the set of weekdays it fires on (0-7; 0 and 7 both Sunday). */
function expandDayOfWeek(field: string): Set<number> {
  const days = new Set<number>();
  for (const item of field.split(",")) {
    const [range] = item.split("/");
    if (range === undefined) continue;
    if (range === "*") {
      for (let day = 0; day <= 7; day += 1) days.add(day);
      continue;
    }
    if (range.includes("-")) {
      const [fromText, toText] = range.split("-");
      if (fromText === undefined || toText === undefined) continue;
      for (let day = Number(fromText); day <= Number(toText); day += 1) days.add(day);
      continue;
    }
    days.add(Number(range));
  }
  return days;
}

function excludesWeekend(field: string): boolean {
  const days = expandDayOfWeek(field);
  return !days.has(0) && !days.has(6) && !days.has(7);
}

/**
 * Runs per day implied by the minute/hour fields, assuming day-of-month and
 * month are `*` — true of every routine in this gallery. Enough to pin
 * "at least N times a day" without a full cron scheduler.
 */
function runsPerDayAtLeast(fields: CronFields): number {
  const minuteCount = fields.minute.split(",").length;
  const hourCount = fields.hour === "*" ? 24 : fields.hour.split(",").length;
  return minuteCount * hourCount;
}

describe("bots/examples: routines run at hours a person would expect", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: has at least one routine, every one in Europe/Prague`, async () => {
      const bot = await loadExampleBot(slug);
      expect(bot.manifest.routines.length, slug).toBeGreaterThan(0);
      for (const routine of bot.manifest.routines) {
        expect(routine.timezone, `${slug}: ${routine.name}`).toBe(DEFAULT_TIMEZONE);
      }
    });
  }

  it("sentry-watch runs at least hourly", async () => {
    const bot = await loadExampleBot("sentry-watch");
    for (const routine of bot.manifest.routines) {
      const fields = parseCronFields(routine.cron);
      expect(
        runsPerDayAtLeast(fields),
        `${routine.name}: "${routine.cron}"`,
      ).toBeGreaterThanOrEqual(24);
    }
  });

  it("pr-triage runs at least three times a day", async () => {
    const bot = await loadExampleBot("pr-triage");
    for (const routine of bot.manifest.routines) {
      const fields = parseCronFields(routine.cron);
      expect(
        runsPerDayAtLeast(fields),
        `${routine.name}: "${routine.cron}"`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  for (const slug of ["inbox-briefing", "github-briefing", "pr-triage", "standup-notes"]) {
    it(`${slug}: every routine skips Saturday and Sunday`, async () => {
      const bot = await loadExampleBot(slug);
      for (const routine of bot.manifest.routines) {
        const fields = parseCronFields(routine.cron);
        expect(
          excludesWeekend(fields.dayOfWeek),
          `${slug}: ${routine.name} runs on day-of-week "${fields.dayOfWeek}"`,
        ).toBe(true);
      }
    });
  }
});

describe("bots/examples: catalog references, secrets and required CLIs are real and documented", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: every mcp entry references a catalog id that exists`, async () => {
      const catalog = await loadShippedCatalog();
      const catalogIds = new Set(catalog.map((entry) => entry.id));
      const text = readFileSync(path.join(EXAMPLES, slug, BOT_YAML), "utf8");
      const manifest = parseManifest(text);
      if (!manifest.ok) throw new Error(manifest.issues.map(formatIssue).join("\n"));
      for (const [name, entry] of Object.entries(manifest.value.mcp)) {
        if ("catalog" in entry) {
          expect(
            catalogIds.has(entry.catalog),
            `${slug}: mcp.${name} references unknown catalog id "${entry.catalog}"`,
          ).toBe(true);
        }
      }
    });

    it(`${slug}: every declared secret is referenced somewhere in the bot's files`, async () => {
      const dir = path.join(EXAMPLES, slug);
      const manifestText = readFileSync(path.join(dir, BOT_YAML), "utf8");
      const manifest = parseManifest(manifestText);
      if (!manifest.ok) throw new Error(manifest.issues.map(formatIssue).join("\n"));
      const botMdText = await readFile(path.join(dir, BOT_MD), "utf8");
      const skillTexts = await readSkillTexts(dir);
      for (const name of manifest.value.secrets) {
        const referenced =
          manifestText.includes(`\${${name}}`) ||
          botMdText.includes(name) ||
          skillTexts.some((text) => text.includes(name));
        expect(
          referenced,
          `${slug}: secret "${name}" is not referenced as \${${name}} in bot.yaml, or by name in BOT.md/SKILL.md`,
        ).toBe(true);
      }
    });

    it(`${slug}: every required CLI is mentioned in BOT.md or a skill`, async () => {
      const dir = path.join(EXAMPLES, slug);
      const manifestText = readFileSync(path.join(dir, BOT_YAML), "utf8");
      const manifest = parseManifest(manifestText);
      if (!manifest.ok) throw new Error(manifest.issues.map(formatIssue).join("\n"));
      const botMdText = await readFile(path.join(dir, BOT_MD), "utf8");
      const skillTexts = await readSkillTexts(dir);
      for (const name of manifest.value.requires) {
        const mentioned =
          botMdText.includes(name) || skillTexts.some((text) => text.includes(name));
        expect(
          mentioned,
          `${slug}: required CLI "${name}" is not mentioned in BOT.md or a skill`,
        ).toBe(true);
      }
    });
  }
});

describe("bots/examples: no file carries a secret or a real-looking identity", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: findSecretLikeStrings finds nothing in any file`, async () => {
      const files = await collectFiles(path.join(EXAMPLES, slug));
      for (const file of files) {
        const text = await readFile(file, "utf8");
        const kinds = findSecretLikeStrings(text).map((match) => match.kind);
        expect(kinds, `${slug}: ${path.relative(EXAMPLES, file)}`).toEqual([]);
      }
    });

    it(`${slug}: no file contains an email address`, async () => {
      const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
      const files = await collectFiles(path.join(EXAMPLES, slug));
      for (const file of files) {
        const text = await readFile(file, "utf8");
        expect(emailPattern.test(text), `${slug}: ${path.relative(EXAMPLES, file)}`).toBe(false);
      }
    });

    it(`${slug}: every URL is example.com or a vendor's own documentation`, async () => {
      const catalog = await loadShippedCatalog();
      const allowedHosts = new Set<string>(["example.com", "www.example.com"]);
      for (const entry of catalog) {
        allowedHosts.add(new URL(entry.docs).hostname);
        if (entry.transport !== "stdio") {
          allowedHosts.add(new URL(entry.url).hostname);
        }
      }
      const urlPattern = /https?:\/\/[^\s)>\]"'`]+/g;
      const files = await collectFiles(path.join(EXAMPLES, slug));
      for (const file of files) {
        const text = await readFile(file, "utf8");
        for (const match of text.matchAll(urlPattern)) {
          const url = match[0];
          const hostname = new URL(url).hostname;
          expect(
            allowedHosts.has(hostname),
            `${slug}: ${path.relative(EXAMPLES, file)} links to "${url}"`,
          ).toBe(true);
        }
      }
    });
  }
});
