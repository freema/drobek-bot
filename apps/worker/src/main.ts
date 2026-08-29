import { Redis } from "ioredis";
import { z } from "zod";

import { startHeartbeat } from "./heartbeat.js";
import type { HeartbeatStore } from "./heartbeat.js";

const envSchema = z.object({
  REDIS_URL: z.string().min(1),
});

function redisStore(redis: Redis): HeartbeatStore {
  return {
    set: async (key, value, ttlSeconds) => {
      await redis.set(key, value, "EX", ttlSeconds);
    },
  };
}

function main(): void {
  const env = envSchema.parse(process.env);

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on("error", (error) => {
    console.error("redis error:", error.message);
  });

  const heartbeat = startHeartbeat(redisStore(redis));
  console.log("worker started");

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`worker received ${signal}, shutting down`);
    heartbeat.stop();
    void redis
      .quit()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main();
