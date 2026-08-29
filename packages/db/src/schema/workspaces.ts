import { bigint, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns.js";
import { actorTypeEnum, userRoleEnum } from "./enums.js";

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    email: text("email").notNull().unique(),
    role: userRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("users_workspace_id_idx").on(table.workspaceId)],
);

/** Append-only: triggers (custom migration) reject UPDATE, DELETE and TRUNCATE. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("audit_events_workspace_id_idx").on(table.workspaceId)],
);
