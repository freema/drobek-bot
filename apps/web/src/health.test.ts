import type { HealthResponse } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { fetchHealth, formatStatusLine, HEALTH_URL } from "./health";

const healthy: HealthResponse = {
  status: "ok",
  service: "api",
  version: "1.4.0",
  commit: "abcdef1",
  checks: { postgres: "ok", redis: "ok", worker: "ok" },
};

const degraded: HealthResponse = {
  status: "degraded",
  service: "api",
  version: "1.4.0",
  commit: "abcdef1",
  checks: { postgres: "fail", redis: "ok", worker: "stale" },
};

describe("formatStatusLine", () => {
  it("says unreachable when the api could not be read", () => {
    expect(formatStatusLine({ kind: "unreachable" })).toBe("api: unreachable");
  });

  it("says checking while loading", () => {
    expect(formatStatusLine({ kind: "loading" })).toBe("api: checking");
  });

  it("includes the version, commit and every check when healthy", () => {
    const line = formatStatusLine({ kind: "ready", health: healthy });
    expect(line).toContain(healthy.version);
    expect(line).toContain(healthy.commit);
    expect(line).toContain(healthy.checks.postgres);
    expect(line).toContain(healthy.checks.redis);
    expect(line).toContain(healthy.checks.worker);
    expect(line).toContain(healthy.status);
  });

  it("includes the version, commit and every check when degraded", () => {
    const line = formatStatusLine({ kind: "ready", health: degraded });
    expect(line).toContain(degraded.version);
    expect(line).toContain(degraded.commit);
    expect(line).toContain(degraded.checks.postgres);
    expect(line).toContain(degraded.checks.redis);
    expect(line).toContain(degraded.checks.worker);
    expect(line).toContain(degraded.status);
  });
});

describe("fetchHealth", () => {
  it("returns a ready state parsed from a valid body", async () => {
    const state = await fetchHealth((url) => {
      expect(url).toBe(HEALTH_URL);
      return Promise.resolve(new Response(JSON.stringify(healthy)));
    });
    expect(state).toEqual({ kind: "ready", health: healthy });
  });

  it("is still ready for a non-200 response carrying a valid body", async () => {
    const state = await fetchHealth(() =>
      Promise.resolve(new Response(JSON.stringify(degraded), { status: 503 })),
    );
    expect(state).toEqual({ kind: "ready", health: degraded });
  });

  it("is unreachable when the body is not valid JSON", async () => {
    const state = await fetchHealth(() => Promise.resolve(new Response("not json{")));
    expect(state).toEqual({ kind: "unreachable" });
  });

  it("is unreachable when the body does not match the health contract", async () => {
    const state = await fetchHealth(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "world" }))),
    );
    expect(state).toEqual({ kind: "unreachable" });
  });

  it("is unreachable when the fetch itself fails", async () => {
    const state = await fetchHealth(() => Promise.reject(new Error("network down")));
    expect(state).toEqual({ kind: "unreachable" });
  });
});
