import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { startHeartbeat } from "./heartbeat.js";

describe("startHeartbeat", () => {
  it("writes the shared key with the shared ttl on start", () => {
    const writes: Array<{ key: string; ttlSeconds: number }> = [];
    const heartbeat = startHeartbeat({
      set: (key, _value, ttlSeconds) => {
        writes.push({ key, ttlSeconds });
        return Promise.resolve();
      },
    });
    heartbeat.stop();
    expect(writes).toEqual([
      { key: WORKER_HEARTBEAT_KEY, ttlSeconds: WORKER_HEARTBEAT_TTL_SECONDS },
    ]);
  });
});
