import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  APPROVAL_RULE_DECISIONS,
  AUTH_MODES,
  MESSAGE_ROLES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  TASK_SOURCES,
  THREAD_KINDS,
  USER_ROLES,
} from "@drobek-bot/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

/** Postgres enums built from the contracts' value lists; the values are never retyped here. */
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const runTriggerEnum = pgEnum("run_trigger", RUN_TRIGGERS);
export const taskSourceEnum = pgEnum("task_source", TASK_SOURCES);
export const approvalDecisionEnum = pgEnum("approval_decision", APPROVAL_DECISIONS);
export const approvalRuleDecisionEnum = pgEnum("approval_rule_decision", APPROVAL_RULE_DECISIONS);
export const authModeEnum = pgEnum("auth_mode", AUTH_MODES);
export const threadKindEnum = pgEnum("thread_kind", THREAD_KINDS);
export const messageRoleEnum = pgEnum("message_role", MESSAGE_ROLES);
export const userRoleEnum = pgEnum("user_role", USER_ROLES);
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);
