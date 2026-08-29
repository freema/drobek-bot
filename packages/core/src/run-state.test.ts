import { RUN_STATUSES, type RunStatus } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { canTransition, RUN_TRANSITIONS } from "./run-state.js";

/** The exact edge list the model promises; every other pair must be refused. */
const EXPECTED_EDGES: ReadonlyArray<readonly [RunStatus, RunStatus]> = [
  ["pending", "provisioning"],
  ["provisioning", "running"],
  ["provisioning", "failed"],
  ["running", "awaiting_approval"],
  ["awaiting_approval", "running"],
  ["running", "completed"],
  ["running", "failed"],
  ["pending", "canceled"],
  ["provisioning", "canceled"],
  ["running", "canceled"],
  ["awaiting_approval", "canceled"],
];

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "canceled"];

function edgeKey(from: RunStatus, to: RunStatus): string {
  return `${from}->${to}`;
}

const EXPECTED_EDGE_SET = new Set(EXPECTED_EDGES.map(([from, to]) => edgeKey(from, to)));

describe("RUN_TRANSITIONS", () => {
  it("has exactly one entry per status in RUN_STATUSES, no more, no less", () => {
    expect(Object.keys(RUN_TRANSITIONS).sort()).toEqual([...RUN_STATUSES].sort());
  });

  it("references only statuses that exist in RUN_STATUSES", () => {
    for (const targets of Object.values(RUN_TRANSITIONS)) {
      for (const target of targets) {
        expect(RUN_STATUSES).toContain(target);
      }
    }
  });

  it("matches exactly the specified edge list, no more, no less", () => {
    const actualEdges = RUN_STATUSES.flatMap((from) =>
      RUN_TRANSITIONS[from].map((to) => edgeKey(from, to)),
    ).sort();
    const expectedEdges = [...EXPECTED_EDGE_SET].sort();
    expect(actualEdges).toEqual(expectedEdges);
  });

  it("never allows a status to transition to itself", () => {
    for (const status of RUN_STATUSES) {
      expect(RUN_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it("gives every terminal status an empty transition list", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(RUN_TRANSITIONS[status]).toEqual([]);
    }
  });

  it("gives every non-terminal status at least one outgoing transition", () => {
    for (const status of RUN_STATUSES) {
      if (TERMINAL_STATUSES.includes(status)) continue;
      expect(RUN_TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });
});

describe("canTransition", () => {
  it("allows pending to provisioning", () => {
    expect(canTransition("pending", "provisioning")).toBe(true);
  });

  it("refuses to leave a terminal status", () => {
    expect(canTransition("completed", "running")).toBe(false);
  });

  it("agrees with RUN_TRANSITIONS for every pair of statuses", () => {
    for (const from of RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        expect(canTransition(from, to)).toBe(RUN_TRANSITIONS[from].includes(to));
      }
    }
  });

  it("allows exactly the specified edges and disallows every other pair", () => {
    for (const from of RUN_STATUSES) {
      for (const to of RUN_STATUSES) {
        expect(canTransition(from, to)).toBe(EXPECTED_EDGE_SET.has(edgeKey(from, to)));
      }
    }
  });

  it("refuses every self-transition", () => {
    for (const status of RUN_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });
});
