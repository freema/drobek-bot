import { WORKER_HEARTBEAT_KEY } from "@drobek-bot/contracts";
import { Redis } from "ioredis";
import pg from "pg";

import type { HealthProbes } from "./health.js";

export interface Dependencies {
  postgres: pg.Pool;
  redis: Redis;
}

export function createDependencies(env: { DATABASE_URL: string; REDIS_URL: string }): Dependencies {
  const postgres = new pg.Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 2,
  });
  postgres.on("error", (error) => {
    console.error("postgres pool error:", error.message);
  });

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on("error", (error) => {
    console.error("redis error:", error.message);
  });

  return { postgres, redis };
}

/** The real probes: `SELECT 1`, `PING`, and the worker's heartbeat key. */
export function createProbes({ postgres, redis }: Dependencies): HealthProbes {
  return {
    postgres: async () => {
      await postgres.query("SELECT 1");
      return true;
    },
    redis: async () => (await redis.ping()) === "PONG",
    worker: async () => (await redis.exists(WORKER_HEARTBEAT_KEY)) === 1,
  };
}

export async function closeDependencies({ postgres, redis }: Dependencies): Promise<void> {
  await Promise.all([postgres.end(), redis.quit()]);
}
