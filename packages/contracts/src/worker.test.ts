import { describe, expect, it } from "vitest";

import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from "./worker.js";

describe("worker heartbeat constants", () => {
  it("names a non-empty key", () => {
    expect(WORKER_HEARTBEAT_KEY.length).toBeGreaterThan(0);
  });

  it("has a positive interval", () => {
    expect(WORKER_HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("has a positive ttl", () => {
    expect(WORKER_HEARTBEAT_TTL_SECONDS).toBeGreaterThan(0);
  });

  it("outlives the interval, so the key never expires between beats", () => {
    expect(WORKER_HEARTBEAT_TTL_SECONDS).toBeGreaterThan(WORKER_HEARTBEAT_INTERVAL_MS / 1000);
  });
});
