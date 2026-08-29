import { z } from "zod";

/**
 * The closed vocabularies shared by the database (Postgres enums) and the
 * app. Each value list exists once, here: the schema in `packages/db` builds
 * its `pgEnum`s from the arrays and everything else uses the zod enums.
 */

/** Keeps a list of string literals as a readonly tuple without a type assertion. */
function values<const T extends readonly [string, ...string[]]>(...items: T): T {
  return items;
}

export const RUN_STATUSES = values(
  "pending",
  "provisioning",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "canceled",
);
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const RUN_TRIGGERS = values("chat", "routine", "api");
export const runTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof runTriggerSchema>;

/** A task comes from the same places a run is triggered from. */
export const TASK_SOURCES = RUN_TRIGGERS;
export const taskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = z.infer<typeof taskSourceSchema>;

export const APPROVAL_DECISIONS = values("allow", "allow_always", "deny");
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const APPROVAL_RULE_DECISIONS = values("allow", "deny", "require_approval");
export const approvalRuleDecisionSchema = z.enum(APPROVAL_RULE_DECISIONS);
export type ApprovalRuleDecision = z.infer<typeof approvalRuleDecisionSchema>;

export const AUTH_MODES = values("subscription", "api_key");
export const authModeSchema = z.enum(AUTH_MODES);
export type AuthMode = z.infer<typeof authModeSchema>;

export const THREAD_KINDS = values("chat", "routine");
export const threadKindSchema = z.enum(THREAD_KINDS);
export type ThreadKind = z.infer<typeof threadKindSchema>;

export const MESSAGE_ROLES = values("user", "assistant", "system");
export const messageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const USER_ROLES = values("owner", "member");
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const ACTOR_TYPES = values("user", "bot", "system");
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof actorTypeSchema>;
