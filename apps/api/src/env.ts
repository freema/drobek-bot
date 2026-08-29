import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GIT_SHA: z.string().min(1).default("dev"),
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
