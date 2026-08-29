import { describe, expect, it } from "vitest";

import { canTransition } from "./run-state.js";

describe("canTransition", () => {
  it("allows pending to provisioning", () => {
    expect(canTransition("pending", "provisioning")).toBe(true);
  });

  it("refuses to leave a terminal status", () => {
    expect(canTransition("completed", "running")).toBe(false);
  });
});
