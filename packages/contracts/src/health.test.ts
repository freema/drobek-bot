import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "./health.js";

const validHealthy = {
  status: "ok",
  service: "api",
  version: "0.0.0",
  commit: "dev",
  checks: { postgres: "ok", redis: "ok", worker: "ok" },
};

describe("healthResponseSchema", () => {
  it("accepts a healthy response", () => {
    const result = healthResponseSchema.safeParse(validHealthy);
    expect(result.success).toBe(true);
  });

  it("accepts a degraded response with failing/stale checks", () => {
    const result = healthResponseSchema.safeParse({
      ...validHealthy,
      status: "degraded",
      checks: { postgres: "fail", redis: "fail", worker: "stale" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a status outside ok/degraded", () => {
    const result = healthResponseSchema.safeParse({ ...validHealthy, status: "healthy" });
    expect(result.success).toBe(false);
  });

  it.each([
    ["postgres", "down"],
    ["redis", "down"],
    ["worker", "dead"],
  ])("rejects an unknown %s check value", (check, value) => {
    const result = healthResponseSchema.safeParse({
      ...validHealthy,
      checks: { ...validHealthy.checks, [check]: value },
    });
    expect(result.success).toBe(false);
  });

  it.each(["status", "service", "version", "commit", "checks"])(
    "rejects a response missing %s",
    (field) => {
      const withoutField: Record<string, unknown> = { ...validHealthy };
      delete withoutField[field];
      const result = healthResponseSchema.safeParse(withoutField);
      expect(result.success).toBe(false);
    },
  );

  it("rejects a service other than api", () => {
    const result = healthResponseSchema.safeParse({ ...validHealthy, service: "worker" });
    expect(result.success).toBe(false);
  });
});
