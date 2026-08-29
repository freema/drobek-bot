import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.js";

describe("healthResponseSchema", () => {
  it("accepts a healthy response", () => {
    const result = healthResponseSchema.safeParse({
      status: "ok",
      service: "api",
      version: "0.0.0",
      commit: "dev",
      checks: { postgres: "ok", redis: "ok", worker: "ok" },
    });
    expect(result.success).toBe(true);
  });
});
