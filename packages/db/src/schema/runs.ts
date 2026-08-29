import {
  bigint,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { bots, threads } from "./bots.js";
import { createdAt, id, timestampTz, updatedAt } from "./columns.js";
import {
  approvalDecisionEnum,
  messageRoleEnum,
  runStatusEnum,
  runTriggerEnum,
  taskSourceEnum,
} from "./enums.js";
import { users } from "./workspaces.js";

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => threads.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    source: taskSourceEnum("source").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("tasks_bot_id_idx").on(table.botId),
    index("tasks_thread_id_idx").on(table.threadId),
  ],
);

/** The lease columns (`lease_*`) fence a run to one worker at a time. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("pending"),
    trigger: runTriggerEnum("trigger").notNull(),
    leaseOwner: text("lease_owner"),
    leaseFence: bigint("lease_fence", { mode: "number" }).notNull().default(0),
    leaseExpiresAt: timestampTz("lease_expires_at"),
    checkpoint: jsonb("checkpoint"),
    error: text("error"),
    startedAt: timestampTz("started_at"),
    completedAt: timestampTz("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("runs_task_id_idx").on(table.taskId),
    index("runs_bot_id_idx").on(table.botId),
    index("runs_thread_id_idx").on(table.threadId),
  ],
);

export const attempts = pgTable(
  "attempts",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: runStatusEnum("status").notNull(),
    startedAt: timestampTz("started_at").notNull().defaultNow(),
    endedAt: timestampTz("ended_at"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (table) => [unique("attempts_run_id_number_unique").on(table.runId, table.number)],
);

/**
 * Rows are immutable but deletable: triggers (custom migration) reject UPDATE
 * and TRUNCATE, while DELETE stays open so the FK cascades can remove a run,
 * thread or bot together with its events.
 */
export const events = pgTable(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("events_run_id_seq_unique").on(table.runId, table.seq),
    index("events_thread_id_idx").on(table.threadId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    role: messageRoleEnum("role").notNull(),
    content: jsonb("content").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("messages_thread_id_idx").on(table.threadId),
    index("messages_run_id_idx").on(table.runId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    input: jsonb("input").notNull(),
    decision: approvalDecisionEnum("decision"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestampTz("requested_at").notNull().defaultNow(),
    decidedAt: timestampTz("decided_at"),
    expiresAt: timestampTz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("approvals_run_id_idx").on(table.runId),
    index("approvals_decided_by_idx").on(table.decidedBy),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    botId: uuid("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("usage_records_run_id_idx").on(table.runId),
    index("usage_records_bot_id_idx").on(table.botId),
  ],
);
