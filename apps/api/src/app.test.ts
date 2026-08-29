import { healthResponseSchema } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import type { HealthProbes } from "./health.js";

const build = { version: "1.2.3", commit: "abc1234" };

const healthyProbes: HealthProbes = {
  postgres: () => Promise.resolve(true),
  redis: () => Promise.resolve(true),
  worker: () => Promise.resolve(true),
};

describe("createApp GET /api/health", () => {
  it("answers 200 with a schema-valid, healthy body", async () => {
    const app = createApp(build, healthyProbes);
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);

    const body: unknown = await response.json();
    const parsed = healthResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("ok");
      expect(parsed.data.version).toBe(build.version);
      expect(parsed.data.commit).toBe(build.commit);
      expect(parsed.data.checks).toEqual({ postgres: "ok", redis: "ok", worker: "ok" });
    }
  });

  it("answers 503 with a degraded body when a check fails", async () => {
    const app = createApp(build, { ...healthyProbes, redis: () => Promise.resolve(false) });
    const response = await app.request("/api/health");
    expect(response.status).toBe(503);

    const body: unknown = await response.json();
    const parsed = healthResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("degraded");
      expect(parsed.data.checks.redis).toBe("fail");
    }
  });

  it("never leaks probe/environment strings into the response body", async () => {
    const secret = "postgres://user:s3cr3t-password@db.internal:5432/app";
    const app = createApp(build, {
      ...healthyProbes,
      postgres: () => Promise.reject(new Error(`connection failed: ${secret}`)),
    });
    const response = await app.request("/api/health");
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(text).not.toContain("s3cr3t-password");
  });

  it("does not answer 200 for POST /api/health", async () => {
    const app = createApp(build, healthyProbes);
    const response = await app.request("/api/health", { method: "POST" });
    expect(response.status).not.toBe(200);
    expect([404, 405]).toContain(response.status);
  });

  it("does not answer 200 for an unknown path", async () => {
    const app = createApp(build, healthyProbes);
    const response = await app.request("/api/does-not-exist");
    expect(response.status).not.toBe(200);
    expect([404, 405]).toContain(response.status);
  });
});
