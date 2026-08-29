import { z } from "zod";

import { isValidCron } from "./cron.js";
import { authModeSchema } from "./enums.js";
import { isToolNamePattern } from "./tool-pattern.js";

/**
 * The bot folder format (`./bots/<slug>/`): the frontmatter of `BOT.md`, the
 * manifest `bot.yaml`, the frontmatter of `skills/<name>/SKILL.md`, the MCP
 * catalog the manifest can refer to, and the shape of the `.mcp.json` the
 * loader writes into the box. The parsers live in `@drobek-bot/bot-format`;
 * the schemas are here so every boundary validates against the same source.
 */

/** Folder names: lowercase letters, digits and single hyphens, 1-64 characters. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z.string().min(1).max(64).regex(SLUG_PATTERN, {
  error: "expected lowercase letters, digits and single hyphens, not at the ends",
});

export type Slug = z.infer<typeof slugSchema>;

/** A short language tag such as `cs`, `en` or `pt-BR`. */
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** `BOT.md` frontmatter: exactly these three keys. */
export const botIdentitySchema = z.strictObject({
  name: z.string().min(1).max(100),
  job: z.string().min(1).max(300),
  language: z.string().regex(LANGUAGE_PATTERN, {
    error: "expected a short language tag such as cs or en",
  }),
});

export type BotIdentity = z.infer<typeof botIdentitySchema>;

export const browserModeSchema = z.enum(["host-cdp", "none", "box"]);
export const BROWSER_MODES = browserModeSchema.options;
export type BrowserMode = z.infer<typeof browserModeSchema>;

/** The transports MCP servers speak. */
export const mcpTransportSchema = z.enum(["http", "sse", "stdio"]);
export type McpTransport = z.infer<typeof mcpTransportSchema>;

export const mcpRemoteTransportSchema = z.enum(["http", "sse"]);
export type McpRemoteTransport = z.infer<typeof mcpRemoteTransportSchema>;

/** MCP server names become tool-name prefixes (`mcp__<name>__<tool>`). */
export const mcpServerNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, {
  error: "expected letters, digits, hyphens and underscores, starting with a letter or digit",
});

/** A remote MCP server; `type` defaults to `http` when the loader writes `.mcp.json`. */
export const mcpRemoteServerSchema = z.strictObject({
  url: z.url(),
  type: mcpRemoteTransportSchema.optional(),
});
export type McpRemoteServer = z.infer<typeof mcpRemoteServerSchema>;

/** A local MCP server the box starts on stdio. */
export const mcpStdioServerSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type McpStdioServer = z.infer<typeof mcpStdioServerSchema>;

/** A reference into the MCP catalog by entry id. */
export const mcpCatalogReferenceSchema = z.strictObject({
  catalog: slugSchema,
});
export type McpCatalogReference = z.infer<typeof mcpCatalogReferenceSchema>;

export const botMcpEntrySchema = z.union(
  [mcpRemoteServerSchema, mcpStdioServerSchema, mcpCatalogReferenceSchema],
  { error: "expected { url, type? }, { command, args?, env? } or { catalog }" },
);
export type BotMcpEntry = z.infer<typeof botMcpEntrySchema>;

/** An `mcp` entry after catalog references have been expanded. */
export const resolvedMcpServerSchema = z.union([mcpRemoteServerSchema, mcpStdioServerSchema]);
export type ResolvedMcpServer = z.infer<typeof resolvedMcpServerSchema>;
export type ResolvedMcp = Record<string, ResolvedMcpServer>;

export const DEFAULT_TIMEZONE = "Europe/Prague";

/** True when the runtime's Intl data knows `zone` (`Europe/Prague`, `UTC`). */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const routineSchema = z.strictObject({
  name: z.string().min(1),
  cron: z.string().refine(isValidCron, {
    error: "expected five cron fields (minute hour day-of-month month day-of-week)",
  }),
  timezone: z
    .string()
    .refine(isValidTimeZone, { error: "expected an IANA time zone such as Europe/Prague" })
    .default(DEFAULT_TIMEZONE),
  prompt: z.string().min(1),
});
export type Routine = z.infer<typeof routineSchema>;

export const budgetSchema = z.strictObject({
  per_run_usd: z.number().positive().optional(),
  per_day_usd: z.number().positive().optional(),
});
export type Budget = z.infer<typeof budgetSchema>;

const toolPatternListSchema = z.array(
  z.string().refine(isToolNamePattern, {
    error: "expected a tool name, a prefix ending in * or * alone",
  }),
);

/**
 * Tool-name patterns per decision. Precedence when more than one matches:
 * deny, then require, then allow. Unlisted tools are left to the broker.
 */
export const approvalPolicySchema = z.strictObject({
  require: toolPatternListSchema.optional(),
  allow: toolPatternListSchema.optional(),
  deny: toolPatternListSchema.optional(),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const botPolicySchema = z.strictObject({
  approvals: approvalPolicySchema,
});
export type BotPolicy = z.infer<typeof botPolicySchema>;

/** `bot.yaml`. Unknown keys are errors; only `version` and `model` are required. */
export const botManifestSchema = z.strictObject({
  version: z.literal(1),
  model: z.string().min(1),
  auth: authModeSchema.optional(),
  browser: browserModeSchema.default("host-cdp"),
  requires: z.array(z.string().min(1)).default([]),
  mcp: z.record(mcpServerNameSchema, botMcpEntrySchema).default({}),
  routines: z
    .array(routineSchema)
    .superRefine((routines, ctx) => {
      const seen = new Set<string>();
      routines.forEach((routine, index) => {
        if (seen.has(routine.name)) {
          ctx.addIssue({
            code: "custom",
            message: `duplicate routine name "${routine.name}"`,
            path: [index, "name"],
          });
        }
        seen.add(routine.name);
      });
    })
    .default([]),
  budget: budgetSchema.optional(),
  policy: botPolicySchema.optional(),
  /** Reserved for the channel feature; any object is accepted for now. */
  channels: z.record(z.string(), z.unknown()).optional(),
});
export type BotManifest = z.infer<typeof botManifestSchema>;

/** `allowed-tools` in a skill: a space- or comma-separated string, or a list. */
export const skillToolListSchema = z.union([z.string(), z.array(z.string())]);

/**
 * `SKILL.md` frontmatter. `name` must equal the skill's folder name;
 * `description` is required. The other documented fields are typed where the
 * spec constrains them and every further key passes through untouched.
 */
export const skillFrontmatterSchema = z.looseObject({
  name: slugSchema,
  description: z.string().min(1).max(1024),
  "allowed-tools": skillToolListSchema.optional(),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export const mcpCatalogAuthSchema = z.enum(["oauth", "token", "none"]);
export type McpCatalogAuth = z.infer<typeof mcpCatalogAuthSchema>;

const catalogEntryBase = {
  id: slugSchema,
  name: z.string().min(1),
  auth: mcpCatalogAuthSchema,
  /** The vendor's own documentation for the server. */
  docs: z.url(),
  notes: z.string().optional(),
};

export const mcpCatalogRemoteEntrySchema = z.strictObject({
  ...catalogEntryBase,
  transport: mcpRemoteTransportSchema,
  url: z.url(),
});
export type McpCatalogRemoteEntry = z.infer<typeof mcpCatalogRemoteEntrySchema>;

export const mcpCatalogStdioEntrySchema = z.strictObject({
  ...catalogEntryBase,
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()),
});
export type McpCatalogStdioEntry = z.infer<typeof mcpCatalogStdioEntrySchema>;

export const mcpCatalogEntrySchema = z.discriminatedUnion("transport", [
  mcpCatalogRemoteEntrySchema,
  mcpCatalogStdioEntrySchema,
]);
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>;

/** `catalog/mcp.json`: the known MCP servers, ids unique. */
export const mcpCatalogSchema = z.array(mcpCatalogEntrySchema).superRefine((entries, ctx) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate catalog id "${entry.id}"`,
        path: [index, "id"],
      });
    }
    seen.add(entry.id);
  });
});
export type McpCatalog = z.infer<typeof mcpCatalogSchema>;

/**
 * The `.mcp.json` Claude Code reads from a project: a `mcpServers` map with
 * stdio entries (`command`, `args`, `env`; `type` may be omitted) and remote
 * entries (`type` `http` or `sse`, `url`, optional `headers`).
 */
export const claudeMcpStdioServerSchema = z.strictObject({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type ClaudeMcpStdioServer = z.infer<typeof claudeMcpStdioServerSchema>;

export const claudeMcpRemoteServerSchema = z.strictObject({
  type: mcpRemoteTransportSchema,
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type ClaudeMcpRemoteServer = z.infer<typeof claudeMcpRemoteServerSchema>;

export const claudeMcpServerSchema = z.union([
  claudeMcpStdioServerSchema,
  claudeMcpRemoteServerSchema,
]);
export type ClaudeMcpServer = z.infer<typeof claudeMcpServerSchema>;

export const claudeMcpConfigSchema = z.strictObject({
  mcpServers: z.record(z.string(), claudeMcpServerSchema),
});
export type ClaudeMcpConfig = z.infer<typeof claudeMcpConfigSchema>;

/** The subset of `.claude/settings.json` the loader writes: the model pin. */
export const claudeSettingsSchema = z.strictObject({
  model: z.string().min(1),
});
export type ClaudeSettings = z.infer<typeof claudeSettingsSchema>;
