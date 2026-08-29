import type { ZodType } from "zod";
import { describe, expect, it } from "vitest";

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
  actorTypeSchema,
  approvalDecisionSchema,
  approvalRuleDecisionSchema,
  authModeSchema,
  messageRoleSchema,
  runStatusSchema,
  runTriggerSchema,
  taskSourceSchema,
  threadKindSchema,
  userRoleSchema,
} from "./enums.js";
import * as fromRoot from "./index.js";

interface EnumSpec {
  readonly name: string;
  readonly values: readonly string[];
  readonly schema: ZodType<string>;
}

const SPECS: readonly EnumSpec[] = [
  { name: "runStatusSchema", values: RUN_STATUSES, schema: runStatusSchema },
  { name: "runTriggerSchema", values: RUN_TRIGGERS, schema: runTriggerSchema },
  { name: "taskSourceSchema", values: TASK_SOURCES, schema: taskSourceSchema },
  { name: "approvalDecisionSchema", values: APPROVAL_DECISIONS, schema: approvalDecisionSchema },
  {
    name: "approvalRuleDecisionSchema",
    values: APPROVAL_RULE_DECISIONS,
    schema: approvalRuleDecisionSchema,
  },
  { name: "authModeSchema", values: AUTH_MODES, schema: authModeSchema },
  { name: "threadKindSchema", values: THREAD_KINDS, schema: threadKindSchema },
  { name: "messageRoleSchema", values: MESSAGE_ROLES, schema: messageRoleSchema },
  { name: "userRoleSchema", values: USER_ROLES, schema: userRoleSchema },
  { name: "actorTypeSchema", values: ACTOR_TYPES, schema: actorTypeSchema },
];

/** Every literal value used by any enum in the package, so "exactly its array" can be tested against real neighbours, not just a made-up string. */
const ALL_VALUES = [...new Set(SPECS.flatMap((spec) => spec.values))];

describe.each(SPECS)("$name", ({ values, schema }) => {
  const ownValues = new Set(values);

  it("accepts exactly its own value array and rejects every other known value", () => {
    for (const value of ALL_VALUES) {
      expect(schema.safeParse(value).success).toBe(ownValues.has(value));
    }
  });

  it("rejects a string that is not a member of any enum", () => {
    expect(schema.safeParse("not-a-real-enum-value").success).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(schema.safeParse(42).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("has no duplicate values", () => {
    expect(values.length).toBe(ownValues.size);
  });
});

describe("TASK_SOURCES", () => {
  it("equals RUN_TRIGGERS: a task comes from the same places a run is triggered from", () => {
    expect(TASK_SOURCES).toEqual(RUN_TRIGGERS);
  });
});

describe("package root re-export", () => {
  it("re-exports every value array and schema unchanged", () => {
    expect(fromRoot.RUN_STATUSES).toEqual(RUN_STATUSES);
    expect(fromRoot.RUN_TRIGGERS).toEqual(RUN_TRIGGERS);
    expect(fromRoot.TASK_SOURCES).toEqual(TASK_SOURCES);
    expect(fromRoot.APPROVAL_DECISIONS).toEqual(APPROVAL_DECISIONS);
    expect(fromRoot.APPROVAL_RULE_DECISIONS).toEqual(APPROVAL_RULE_DECISIONS);
    expect(fromRoot.AUTH_MODES).toEqual(AUTH_MODES);
    expect(fromRoot.THREAD_KINDS).toEqual(THREAD_KINDS);
    expect(fromRoot.MESSAGE_ROLES).toEqual(MESSAGE_ROLES);
    expect(fromRoot.USER_ROLES).toEqual(USER_ROLES);
    expect(fromRoot.ACTOR_TYPES).toEqual(ACTOR_TYPES);

    expect(fromRoot.runStatusSchema.safeParse("pending").success).toBe(true);
    expect(fromRoot.actorTypeSchema.safeParse("bot").success).toBe(true);
  });
});
