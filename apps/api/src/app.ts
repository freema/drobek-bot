import { Hono } from "hono";

import { assembleHealth, healthStatusCode, runHealthChecks } from "./health.js";
import type { BuildInfo, HealthProbes } from "./health.js";

export function createApp(build: BuildInfo, probes: HealthProbes): Hono {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    const checks = await runHealthChecks(probes);
    const body = assembleHealth(build, checks);
    return c.json(body, healthStatusCode(body));
  });

  return app;
}
