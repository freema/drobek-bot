import type { HealthChecks, HealthResponse } from "@drobek-bot/contracts";

export interface BuildInfo {
  version: string;
  commit: string;
}

/** Pure: derives the health response from the build info and the check results. */
export function assembleHealth(build: BuildInfo, checks: HealthChecks): HealthResponse {
  const status =
    checks.postgres === "ok" && checks.redis === "ok" && checks.worker === "ok" ? "ok" : "degraded";
  return { status, service: "api", version: build.version, commit: build.commit, checks };
}

/** Pure: the HTTP status the response is served with. */
export function healthStatusCode(response: HealthResponse): 200 | 503 {
  return response.status === "ok" ? 200 : 503;
}

/** A probe resolves `true` when its dependency answers; it may reject or hang. */
export type Probe = () => Promise<boolean>;

export interface HealthProbes {
  postgres: Probe;
  redis: Probe;
  worker: Probe;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/**
 * Runs the probes concurrently and maps them to check results. A probe that
 * rejects, throws or exceeds the timeout counts as down.
 */
export async function runHealthChecks(
  probes: HealthProbes,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<HealthChecks> {
  const [postgres, redis, worker] = await Promise.all([
    probeSafely(probes.postgres, timeoutMs),
    probeSafely(probes.redis, timeoutMs),
    probeSafely(probes.worker, timeoutMs),
  ]);
  return {
    postgres: postgres ? "ok" : "fail",
    redis: redis ? "ok" : "fail",
    worker: worker ? "ok" : "stale",
  };
}

async function probeSafely(probe: Probe, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([probe(), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
