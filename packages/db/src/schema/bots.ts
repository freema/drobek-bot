import { boolean, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { bytea, createdAt, id, timestampTz, updatedAt } from "./columns.js";
import { approvalRuleDecisionEnum, authModeEnum, threadKindEnum } from "./enums.js";
import { users, workspaces } from "./workspaces.js";

export const bots = pgTable(
  "bots",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    path: text("path").notNull(),
    model: text("model").notNull(),
    authMode: authModeEnum("auth_mode").notNull(),
    computerId: text("computer_id"),
    archivedAt: timestampTz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [unique("bots_workspace_id_slug_unique").on(table.workspaceId, table.slug)],
);

export const threads = pgTable(
  "threads",
  {
    id: id(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    kind: threadKindEnum("kind").notNull(),
    title: text("title").notNull(),
    archivedAt: timestampTz("archived_at"),
    createdAt: createdAt(),
  },
  (table) => [index("threads_bot_id_idx").on(table.botId)],
);

export const routines = pgTable(
  "routines",
  {
    id: id(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    crons: text("crons").array().notNull(),
    timezone: text("timezone").notNull().default("Europe/Prague"),
    active: boolean("active").notNull().default(false),
    lastRunAt: timestampTz("last_run_at"),
    nextRunAt: timestampTz("next_run_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("routines_bot_id_idx").on(table.botId)],
);

export const approvalRules = pgTable(
  "approval_rules",
  {
    id: id(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    toolPattern: text("tool_pattern").notNull(),
    decision: approvalRuleDecisionEnum("decision").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("approval_rules_bot_id_idx").on(table.botId),
    index("approval_rules_created_by_idx").on(table.createdBy),
  ],
);

/**
 * Encrypted at rest with a per-row data key; `bot_id` null means a
 * workspace-level secret. NULLS NOT DISTINCT keeps one such secret per name.
 */
export const secrets = pgTable(
  "secrets",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    botId: uuid("bot_id").references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    encryptedDataKey: bytea("encrypted_data_key").notNull(),
    keyId: text("key_id").notNull(),
    nonce: bytea("nonce").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("secrets_workspace_id_bot_id_name_unique")
      .on(table.workspaceId, table.botId, table.name)
      .nullsNotDistinct(),
    index("secrets_bot_id_idx").on(table.botId),
  ],
);
