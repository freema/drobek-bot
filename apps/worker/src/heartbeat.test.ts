import { WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECONDS } from "@drobek-bot/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startHeartbeat } from "./heartbeat.js";
import type { HeartbeatStore } from "./heartbeat.js";

interface Write {
  key: string;
  value: string;
  ttlSeconds: number;
}

function recordingStore(writes: Write[]): HeartbeatStore {
  return {
    set: (key, value, ttlSeconds) => {
      writes.push({ key, value, ttlSeconds });
      return Promise.resolve();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startHeartbeat", () => {
  it("writes the shared key with the shared ttl on start", () => {
    const writes: Write[] = [];
    const heartbeat = startHeartbeat(recordingStore(writes));
    heartbeat.stop();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      key: WORKER_HEARTBEAT_KEY,
      ttlSeconds: WORKER_HEARTBEAT_TTL_SECONDS,
    });
  });

  it("beats immediately on start, before any interval elapses", async () => {
    vi.useFakeTimers();
    const writes: Write[] = [];
    const heartbeat = startHeartbeat(recordingStore(writes), { intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    heartbeat.stop();
    expect(writes).toHaveLength(1);
  });

  it("repeats on the configured interval until stop() is called", async () => {
    vi.useFakeTimers();
    const writes: Write[] = [];
    const heartbeat = startHeartbeat(recordingStore(writes), { intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toHaveLength(3);

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writes).toHaveLength(3);
  });

  it("uses a custom key, interval and ttl when given", async () => {
    vi.useFakeTimers();
    const writes: Write[] = [];
    const heartbeat = startHeartbeat(recordingStore(writes), {
      key: "custom:heartbeat",
      intervalMs: 5_000,
      ttlSeconds: 15,
    });
    await vi.advanceTimersByTimeAsync(0);
    heartbeat.stop();
    expect(writes[0]).toMatchObject({ key: "custom:heartbeat", ttlSeconds: 15 });
  });

  it("stamps each beat with the injected clock", async () => {
    vi.useFakeTimers();
    const writes: Write[] = [];
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    const heartbeat = startHeartbeat(recordingStore(writes), {
      intervalMs: 1_000,
      now: () => fixed,
    });
    await vi.advanceTimersByTimeAsync(0);
    heartbeat.stop();
    expect(writes[0]?.value).toBe(fixed.toISOString());
  });

  it("reports a store write failure through onError and keeps beating", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let calls = 0;
    const store: HeartbeatStore = {
      set: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("redis unavailable"));
        }
        return Promise.resolve();
      },
    };
    const heartbeat = startHeartbeat(store, {
      intervalMs: 1_000,
      onError: (error) => errors.push(error),
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);

    heartbeat.stop();
  });

  it("never rejects from beat() even when the store always fails", async () => {
    const store: HeartbeatStore = {
      set: () => Promise.reject(new Error("always fails")),
    };
    const errors: unknown[] = [];
    const heartbeat = startHeartbeat(store, {
      intervalMs: 1_000,
      onError: (error) => errors.push(error),
    });
    heartbeat.stop();
    await expect(heartbeat.beat()).resolves.toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });
});
