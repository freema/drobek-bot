import type { HealthChecks, HealthResponse } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { assembleHealth, healthStatusCode, runHealthChecks } from "./health.js";
import type { HealthProbes, Probe } from "./health.js";

const build = { version: "0.0.0", commit: "dev" };

describe("assembleHealth", () => {
  it("reports ok when every check is ok", () => {
    const response = assembleHealth(build, { postgres: "ok", redis: "ok", worker: "ok" });
    expect(response.status).toBe("ok");
  });

  it.each<HealthChecks>([
    { postgres: "fail", redis: "ok", worker: "ok" },
    { postgres: "ok", redis: "fail", worker: "ok" },
    { postgres: "ok", redis: "ok", worker: "stale" },
    { postgres: "fail", redis: "fail", worker: "stale" },
  ])("reports degraded when any check is not ok (%o)", (checks) => {
    expect(assembleHealth(build, checks).status).toBe("degraded");
  });

  it("carries the build info and checks through unchanged", () => {
    const checks: HealthChecks = { postgres: "ok", redis: "fail", worker: "stale" };
    const response = assembleHealth(build, checks);
    expect(response.service).toBe("api");
    expect(response.version).toBe(build.version);
    expect(response.commit).toBe(build.commit);
    expect(response.checks).toEqual(checks);
  });
});

describe("healthStatusCode", () => {
  it("is 200 for ok", () => {
    const response: HealthResponse = assembleHealth(build, {
      postgres: "ok",
      redis: "ok",
      worker: "ok",
    });
    expect(healthStatusCode(response)).toBe(200);
  });

  it("is 503 for degraded", () => {
    const response: HealthResponse = assembleHealth(build, {
      postgres: "fail",
      redis: "ok",
      worker: "ok",
    });
    expect(healthStatusCode(response)).toBe(503);
  });
});

const healthyProbes: HealthProbes = {
  postgres: () => Promise.resolve(true),
  redis: () => Promise.resolve(true),
  worker: () => Promise.resolve(true),
};

describe("runHealthChecks", () => {
  it("maps healthy probes to ok checks", async () => {
    const checks = await runHealthChecks(healthyProbes);
    expect(checks).toEqual({ postgres: "ok", redis: "ok", worker: "ok" });
  });

  it("maps a rejecting probe to fail", async () => {
    const rejecting: Probe = () => Promise.reject(new Error("connection refused"));
    const checks = await runHealthChecks({ ...healthyProbes, postgres: rejecting });
    expect(checks.postgres).toBe("fail");
  });

  it("maps a throwing probe to fail", async () => {
    const throwing: Probe = () => {
      throw new Error("boom");
    };
    const checks = await runHealthChecks({ ...healthyProbes, redis: throwing });
    expect(checks.redis).toBe("fail");
  });

  it("maps a probe that exceeds the timeout to fail/stale", async () => {
    const hanging: Probe = () => new Promise<boolean>(() => undefined);
    const checks = await runHealthChecks(
      { postgres: hanging, redis: hanging, worker: hanging },
      10,
    );
    expect(checks).toEqual({ postgres: "fail", redis: "fail", worker: "stale" });
  });

  it("maps a false worker probe to stale, not fail", async () => {
    const checks = await runHealthChecks({
      ...healthyProbes,
      worker: () => Promise.resolve(false),
    });
    expect(checks.worker).toBe("stale");
  });

  it("maps a false postgres/redis probe to fail, not stale", async () => {
    const checks = await runHealthChecks({
      ...healthyProbes,
      postgres: () => Promise.resolve(false),
      redis: () => Promise.resolve(false),
    });
    expect(checks.postgres).toBe("fail");
    expect(checks.redis).toBe("fail");
  });
});
