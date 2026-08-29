import { masterKeySchema } from "@drobek-bot/contracts";
import { z } from "zod";

/**
 * `DROBEK_MASTER_KEY` is optional and an empty value (compose passes one
 * when `.env` leaves it blank) counts as unset. When present it must decode
 * to 32 bytes; the failure names the variable and never echoes the value.
 */
const optionalMasterKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  masterKeySchema.optional(),
);

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  GIT_SHA: z.string().min(1).default("dev"),
  DROBEK_MASTER_KEY: optionalMasterKey,
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
