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
const README = fileURLToPath(new URL("../../../README.md", import.meta.url));

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

/** Absolute paths to `BOT.md` and every `skills/<name>/SKILL.md` under a bot's folder — the prose the agent inside the box actually reads. */
async function proseFilePaths(dir: string): Promise<string[]> {
  const skillsDir = path.join(dir, SKILLS_DIR);
  let skillNames: string[];
  try {
    skillNames = (await readdir(skillsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    skillNames = [];
  }
  return [
    path.join(dir, BOT_MD),
    ...skillNames.map((name) => path.join(skillsDir, name, SKILL_MD)),
  ];
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

/**
 * The real tool surfaces of the MCP servers the example gallery declares,
 * captured 2026-08-29 against the upstream source trees — not invented by
 * generalizing one server's naming onto another (that mistake is why this
 * file once asserted on `mcp__sentry__list_issues`, a tool Sentry has never
 * exposed):
 *
 *   - github: github.com/github/github-mcp-server, the tool list in its README
 *   - sentry: github.com/getsentry/sentry-mcp, tool definitions under
 *     packages/mcp-core/src/tools/catalog/, plus the two "special" tools in
 *     tools/special/, which reach clients as `search_sentry_tools` and
 *     `execute_sentry_tool`
 *
 * `playwright` has no recorded surface here on purpose: every ratchet test
 * below skips any server that isn't a key of this table.
 *
 * `mcpTool` is the only way this file spells out an `mcp__<server>__<tool>`
 * literal, so a name that isn't in the surface below fails fast at module
 * load instead of quietly asserting on a tool that doesn't exist.
 *
 * This table backs two checks: the policy ratchet below, which pins what
 * `bot.yaml`'s `policy.approvals` is allowed to name, and the prose ratchet
 * further down, which pins what `BOT.md` and `SKILL.md` — the instructions
 * the agent inside the box actually reads — are allowed to tell it to call.
 * A bot can be denied a phantom tool by policy and still be told by its own
 * prose to call one; only the second check catches that.
 */
const MCP_TOOL_SURFACE: Record<string, ReadonlySet<string>> = {
  github: new Set([
    "actions_get",
    "actions_list",
    "actions_run_trigger",
    "add_comment_to_pending_review",
    "add_issue_comment",
    "add_reply_to_pull_request_comment",
    "assign_copilot_to_issue",
    "assign_copilot_to_issue_with_intent",
    "create_branch",
    "create_gist",
    "create_or_update_file",
    "create_pull_request",
    "create_pull_request_with_copilot",
    "create_repository",
    "delete_file",
    "delete_repository",
    "discussion_comment_write",
    "dismiss_notification",
    "fork_repository",
    "get_code_quality_finding",
    "get_code_scanning_alert",
    "get_commit",
    "get_copilot_space",
    "get_dependabot_alert",
    "get_discussion",
    "get_discussion_comments",
    "get_file_contents",
    "get_gist",
    "get_global_security_advisory",
    "get_job_logs",
    "get_label",
    "get_latest_release",
    "get_me",
    "get_notification_details",
    "get_release_by_tag",
    "get_repository_tree",
    "get_secret_scanning_alert",
    "get_tag",
    "get_team_members",
    "get_teams",
    "github_support_docs_search",
    "issue_read",
    "issue_write",
    "label_write",
    "list_branches",
    "list_code_scanning_alerts",
    "list_commits",
    "list_copilot_spaces",
    "list_dependabot_alerts",
    "list_discussion_categories",
    "list_discussions",
    "list_gists",
    "list_global_security_advisories",
    "list_issue_fields",
    "list_issue_types",
    "list_issues",
    "list_label",
    "list_notifications",
    "list_org_repository_security_advisories",
    "list_pull_requests",
    "list_releases",
    "list_repository_collaborators",
    "list_repository_security_advisories",
    "list_secret_scanning_alerts",
    "list_starred_repositories",
    "list_tags",
    "manage_notification_subscription",
    "manage_repository_notification_subscription",
    "mark_all_notifications_read",
    "merge_pull_request",
    "projects_get",
    "projects_list",
    "projects_write",
    "pull_request_read",
    "pull_request_review_write",
    "push_files",
    "request_copilot_review",
    "search_code",
    "search_commits",
    "search_issues",
    "search_orgs",
    "search_pull_requests",
    "search_repositories",
    "search_users",
    "star_repository",
    "sub_issue_write",
    "unstar_repository",
    "update_gist",
    "update_pull_request",
    "update_pull_request_branch",
  ]),
  sentry: new Set([
    // read-only
    "whoami",
    "find_organizations",
    "find_projects",
    "find_teams",
    "find_releases",
    "find_dsns",
    "find_monitors",
    "find_alert_rules",
    "find_dashboards",
    "find_uptime_monitors",
    "get_issue_details",
    "get_issue_activity",
    "get_issue_breadcrumbs",
    "get_issue_tag_values",
    "get_issue_user_reports",
    "get_doc",
    "get_event_attachment",
    "get_event_stacktrace",
    "get_trace_details",
    "get_span_details",
    "get_profile",
    "get_profile_details",
    "get_release_details",
    "get_replay_details",
    "get_sentry_resource",
    "get_alert_rule",
    "get_dashboard_details",
    "get_monitor_details",
    "get_uptime_monitor_details",
    "get_agent_conversation_details",
    "search_docs",
    "search_events",
    "search_issues",
    "search_issue_events",
    "search_agent_conversations",
    "search_tools",
    // writing
    "add_issue_note",
    "add_team_to_project",
    "create_dsn",
    "create_project",
    "create_team",
    "create_uptime_monitor",
    "update_dsn",
    "update_issue",
    "update_project",
    "update_uptime_monitor",
    "remove_team_from_project",
    "onboarding_status_update",
    "analyze_issue_with_seer",
    // destructive / raw
    "delete_uptime_monitor",
    "execute_sentry_tool",
    "search_sentry_tools",
  ]),
};

/** Spells `mcp__<server>__<tool>`, refusing at module load a `tool` that isn't on the recorded surface. */
function mcpTool(server: string, tool: string): string {
  if (!MCP_TOOL_SURFACE[server]?.has(tool)) {
    throw new Error(`"${tool}" is not on the recorded ${server} MCP tool surface`);
  }
  return `mcp__${server}__${tool}`;
}

describe("bots/examples: MCP servers deny the destructive tools, allow the read-only ones", () => {
  const READ_ONLY_TOOLS: Record<string, readonly string[]> = {
    github: [
      mcpTool("github", "list_issues"),
      mcpTool("github", "list_pull_requests"),
      mcpTool("github", "search_issues"),
      mcpTool("github", "pull_request_read"),
      mcpTool("github", "issue_read"),
      mcpTool("github", "get_file_contents"),
    ],
    sentry: [
      mcpTool("sentry", "whoami"),
      mcpTool("sentry", "find_organizations"),
      mcpTool("sentry", "find_projects"),
      mcpTool("sentry", "get_issue_details"),
      mcpTool("sentry", "search_issues"),
      mcpTool("sentry", "search_events"),
    ],
  };

  const DENY_TOOLS: Record<string, readonly string[]> = {
    github: [
      mcpTool("github", "merge_pull_request"),
      mcpTool("github", "delete_repository"),
      mcpTool("github", "delete_file"),
      mcpTool("github", "push_files"),
    ],
    sentry: [mcpTool("sentry", "delete_uptime_monitor"), mcpTool("sentry", "execute_sentry_tool")],
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

/**
 * The ratchet that would have caught the phantom-tool bug this file used to
 * carry: every literal `mcp__<server>__<tool>` pattern a bot's policy names
 * must be a tool the server actually exposes, per `MCP_TOOL_SURFACE` above.
 * A wildcard (`mcp__github__delete_*`) is exempt on purpose — a broad `deny`
 * glob covering tools that don't exist yet is deliberate fail-safe design,
 * not a claim that every expansion is real. Servers with no recorded
 * surface (`playwright`) are skipped entirely.
 */
describe("bots/examples: every literal MCP tool a policy names is real", () => {
  for (const slug of exampleDirs) {
    for (const serverName of declaredMcpServerNames(slug)) {
      const surface = MCP_TOOL_SURFACE[serverName];
      if (surface === undefined) continue;

      it(`${slug}: literal mcp__${serverName}__* patterns in policy.approvals name real tools`, async () => {
        const bot = await loadExampleBot(slug);
        const approvals = approvalsOf(bot, slug);
        const prefix = `mcp__${serverName}__`;
        const literalPatterns = [
          ...(approvals.deny ?? []),
          ...(approvals.require ?? []),
          ...(approvals.allow ?? []),
        ].filter((pattern) => pattern.startsWith(prefix) && !pattern.endsWith("*"));

        for (const pattern of literalPatterns) {
          const tool = pattern.slice(prefix.length);
          expect(
            surface.has(tool),
            `${slug}: "${pattern}" names a ${serverName} tool that doesn't exist`,
          ).toBe(true);
        }
      });
    }
  }
});

/** A lowercase snake_case token with at least one underscore — the shape every real MCP tool name has. */
const TOOL_SHAPED_IDENTIFIER = /^[a-z][a-z0-9_]*_[a-z0-9_]+$/;

/**
 * Identifiers that match `TOOL_SHAPED_IDENTIFIER` but are not tool names —
 * a parameter of a real tool, or one of that parameter's enum values,
 * written inline next to the tool it belongs to. Each entry is justified
 * below; a name that matches the shape and isn't a real tool *and* isn't
 * justified here is a finding, never something to add to this list to get
 * green.
 */
const PROSE_NON_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set([
  // A boolean parameter of the github server's `get_job_logs` tool
  // ("only the failed jobs' logs"), not a tool itself.
  "failed_only",
  // Values of `pull_request_read`'s own `method` parameter: GitHub folded
  // the old get_pull_request_files / get_pull_request_status tools into
  // this one tool, selected with `method: get_files` / `method: get_status`.
  "get_files",
  "get_status",
]);

/** The content of every backtick-delimited inline code span in `text`, fenced ``` code blocks (example output, not instructions) excluded. */
function inlineCodeSpans(text: string): string[] {
  const withoutFencedBlocks = text.replace(/```[\s\S]*?```/g, "");
  const spans = withoutFencedBlocks.match(/`[^`\n]+`/g) ?? [];
  return spans.map((span) => span.slice(1, -1));
}

/**
 * The ratchet a policy check can never cover: the instructions a bot's own
 * `BOT.md` and `SKILL.md` files give the agent inside the box. A tool named
 * there that does not exist is a broken bot no matter how correct its
 * policy is — a bot's policy can deny a phantom tool by name and its prose
 * can still tell it to call that same phantom tool. Checked only against
 * the surfaces of servers the bot actually declares; a bot with no recorded
 * surface for any of them (`playwright`-only) is skipped entirely, as in
 * the policy ratchet above.
 */
describe("bots/examples: every tool-shaped identifier in a bot's prose is a real tool", () => {
  for (const slug of exampleDirs) {
    const surfaces = declaredMcpServerNames(slug)
      .map((serverName) => MCP_TOOL_SURFACE[serverName])
      .filter((surface): surface is ReadonlySet<string> => surface !== undefined);
    if (surfaces.length === 0) continue;

    it(`${slug}: BOT.md and every SKILL.md name only real tools`, async () => {
      const dir = path.join(EXAMPLES, slug);
      for (const file of await proseFilePaths(dir)) {
        const text = await readFile(file, "utf8");
        for (const identifier of inlineCodeSpans(text)) {
          if (!TOOL_SHAPED_IDENTIFIER.test(identifier)) continue;
          if (PROSE_NON_TOOL_IDENTIFIERS.has(identifier)) continue;

          const isRealTool = surfaces.some((surface) => surface.has(identifier));
          expect(
            isRealTool,
            `${slug}: ${path.relative(EXAMPLES, file)} names "${identifier}", which is not a real tool on any server this bot declares`,
          ).toBe(true);
        }
      }
    });
  }
});

const EXAMPLE_BOTS_HEADING = "\n## Example bots\n";

/**
 * The body of README.md's "## Example bots" section, up to the next `## `
 * heading. Same shape as `examples-readme.test.ts`'s own section helper,
 * kept local here rather than imported across test files.
 */
function exampleBotsSection(): string {
  const text = readFileSync(README, "utf8");
  const headingIndex = text.indexOf(EXAMPLE_BOTS_HEADING);
  if (headingIndex === -1) {
    throw new Error('README.md has no "## Example bots" section');
  }
  const sectionStart = headingIndex + EXAMPLE_BOTS_HEADING.length;
  const nextHeadingIndex = text.indexOf("\n## ", sectionStart);
  return text.slice(sectionStart, nextHeadingIndex === -1 ? text.length : nextHeadingIndex);
}

/** Each example bot's `### ` card heading in the README — not derivable from its slug (`GitHub briefing`, `PR triage`), so spelled out once. */
const CARD_HEADING: Record<string, string> = {
  "inbox-briefing": "Inbox briefing",
  "github-briefing": "GitHub briefing",
  "pr-triage": "PR triage",
  "sentry-watch": "Sentry watch",
  "standup-notes": "Standup notes",
};

/** One example bot's card body: `### <heading>` up to the next `### ` or the end of the section. */
function cardSection(slug: string): string {
  const heading = CARD_HEADING[slug];
  if (heading === undefined) {
    throw new Error(`no README card heading recorded for "${slug}"`);
  }
  const section = exampleBotsSection();
  const cardHeading = `### ${heading}\n`;
  const cardStart = section.indexOf(cardHeading);
  if (cardStart === -1) {
    throw new Error(`README.md has no "### ${heading}" card`);
  }
  const bodyStart = cardStart + cardHeading.length;
  const nextCardStart = section.indexOf("\n### ", bodyStart);
  return section.slice(bodyStart, nextCardStart === -1 ? section.length : nextCardStart);
}

/** The text after `- **<label>:**` on its line in a card body, or undefined when the card has no such line. */
function cardLine(card: string, label: string): string | undefined {
  const pattern = new RegExp(`^- \\*\\*${label}:\\*\\* (.+)$`, "m");
  const match = pattern.exec(card);
  return match === null ? undefined : match[1];
}

/**
 * Bare MCP tool names for a card verb: `exact` names, and `prefixes` that
 * expand to every real tool with that prefix on a server's recorded
 * `MCP_TOOL_SURFACE` (a server with none, `playwright`, is trusted as
 * named — this ratchet checks deny *coverage*, not tool existence; the
 * prose ratchet above already owns existence). Deliberately has no way to
 * name a core tool such as `Bash`: see the comment on `VERB_RULES` for why.
 */
interface VerbRule {
  readonly exact?: readonly string[];
  readonly prefixes?: readonly string[];
}

/**
 * Every verb the gallery's five README "Never" lines actually use, and the
 * MCP tools that would perform it. Deliberately MCP-tools-only — no verb
 * here names `Bash`, on purpose: a `git push`, a `gh pr merge` and an `rm`
 * all run the same way, through the shell, so pairing `Bash` with one verb
 * and not the others would be arbitrary, and pairing it with every verb
 * would make "Never" say nothing for any bot that has a shell at all. This
 * table's job is narrower and honest about it: "with its own MCP tools,
 * this bot will not merge / push / delete / …". The shell gets its own
 * check below ("a card whose Bash is not denied says so under Asks"),
 * which forces a bot that can be asked to run any command to say so on the
 * card — do not fold `Bash` back into this table to "fix" that; it would
 * just make the two checks overlap and the promise vaguer, not stronger.
 *
 * This is the same bug class as the phantom-tool ratchets above, one level
 * up: GitHub's MCP tools consolidate verbs behind a `method` argument
 * (`label_write` does create/update/delete; `issue_write` carries a
 * `state`), so a `deny: create_*` prefix rule does not on its own stop
 * every way to create something, and English prose cannot be trusted to
 * track that by itself.
 */
const VERB_RULES: Record<string, VerbRule> = {
  merges: { exact: ["merge_pull_request"] },
  pushes: { exact: ["push_files"] },
  deletes: { prefixes: ["delete_"] },
  reviews: { exact: ["pull_request_review_write"] },
  "opens a pull request": { exact: ["create_pull_request"] },
  "touches your notifications": {
    exact: ["dismiss_notification", "mark_all_notifications_read"],
  },
  "uploads a file": { exact: ["browser_file_upload"] },
  "runs a script": { exact: ["browser_evaluate"], prefixes: ["browser_run_code"] },
  closes: { exact: ["browser_close"] },
  "calls the raw Sentry API": { exact: ["execute_sentry_tool"] },
};

/** `mcp__<server>__<tool>` for every tool `rule` names, resolved against the servers `serverNames` declares. */
function verbTools(rule: VerbRule, serverNames: readonly string[]): string[] {
  const tools: string[] = [];
  for (const serverName of serverNames) {
    const surface = MCP_TOOL_SURFACE[serverName];
    for (const name of rule.exact ?? []) {
      if (surface === undefined || surface.has(name)) tools.push(`mcp__${serverName}__${name}`);
    }
    for (const prefix of rule.prefixes ?? []) {
      if (surface === undefined) {
        tools.push(`mcp__${serverName}__${prefix}`);
        continue;
      }
      for (const name of surface) {
        if (name.startsWith(prefix)) tools.push(`mcp__${serverName}__${name}`);
      }
    }
  }
  return tools;
}

/**
 * The ratchet a blind acceptance pass earned: a README card's `- **Never:**`
 * line is a promise about what the bot cannot be made to do, and that
 * promise is only true when `bot.yaml`'s `policy.approvals` actually denies
 * every tool that would do it — not merely one of several ways to do it.
 */
describe("bots/examples: a card's Never list is backed by deny, not just prose", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: every Never verb the README card uses is denied by the bot's policy`, async () => {
      const neverLine = cardLine(cardSection(slug), "Never");
      if (neverLine === undefined) {
        throw new Error(`${slug}: README card has no "- **Never:**" line`);
      }
      const bot = await loadExampleBot(slug);
      const approvals = approvalsOf(bot, slug);
      const serverNames = declaredMcpServerNames(slug);

      for (const [verb, rule] of Object.entries(VERB_RULES)) {
        if (!neverLine.includes(verb)) continue;
        for (const tool of verbTools(rule, serverNames)) {
          expect(
            decideApproval(tool, approvals),
            `${slug}: card promises "Never ... ${verb} ...", but "${tool}" decides "${decisionOrThrow(tool, approvals)}", not "deny"`,
          ).toBe("deny");
        }
      }
    });
  }
});

/**
 * The converse, for the shell specifically: `Bash` reaches past whatever a
 * bot's MCP deny rules cover (see `pushes` above), so a bot that can be
 * asked to run any command has to say so. Only a bot whose policy denies
 * `Bash` outright (`pr-triage`) is exempt from mentioning it.
 */
describe("bots/examples: a card whose Bash is not denied says so under Asks", () => {
  for (const slug of exampleDirs) {
    it(`${slug}: Bash denied outright, or the card's Asks line mentions the shell`, async () => {
      const bot = await loadExampleBot(slug);
      const approvals = approvalsOf(bot, slug);
      if (decideApproval("Bash", approvals) === "deny") return;

      const asksLine = cardLine(cardSection(slug), "Asks");
      expect(
        asksLine !== undefined && /\bshell\b/i.test(asksLine),
        `${slug}: Bash is not denied by policy.approvals, but the README card's "- **Asks:**" line does not mention the shell`,
      ).toBe(true);
    });
  }
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
