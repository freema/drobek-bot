import { z } from "zod";

/**
 * Response contract of `GET /api/health`.
 *
 * `status` is `ok` only when every check is `ok`; the endpoint answers 200 for
 * `ok` and 503 for `degraded`.
 */
export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.literal("api"),
  version: z.string(),
  commit: z.string(),
  checks: z.object({
    postgres: z.enum(["ok", "fail"]),
    redis: z.enum(["ok", "fail"]),
    worker: z.enum(["ok", "stale"]),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type HealthChecks = HealthResponse["checks"];
export type HealthStatus = HealthResponse["status"];
