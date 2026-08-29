import {
  WORKER_HEARTBEAT_INTERVAL_MS,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
} from "@drobek-bot/contracts";

/** The only thing the heartbeat needs from Redis: `SET key value EX ttl`. */
export interface HeartbeatStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface HeartbeatOptions {
  key?: string;
  intervalMs?: number;
  ttlSeconds?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

export interface Heartbeat {
  /** Writes one beat now. Never rejects: failures go to `onError`. */
  beat(): Promise<void>;
  stop(): void;
}

/**
 * Writes the heartbeat key immediately and then every `intervalMs`, each time
 * with a `ttlSeconds` expiry, until `stop()` is called.
 */
export function startHeartbeat(store: HeartbeatStore, options: HeartbeatOptions = {}): Heartbeat {
  const key = options.key ?? WORKER_HEARTBEAT_KEY;
  const intervalMs = options.intervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const ttlSeconds = options.ttlSeconds ?? WORKER_HEARTBEAT_TTL_SECONDS;
  const now = options.now ?? (() => new Date());
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error("heartbeat failed:", error instanceof Error ? error.message : error);
    });

  const beat = async (): Promise<void> => {
    try {
      await store.set(key, now().toISOString(), ttlSeconds);
    } catch (error) {
      onError(error);
    }
  };

  const timer = setInterval(() => {
    void beat();
  }, intervalMs);
  void beat();

  return {
    beat,
    stop: () => {
      clearInterval(timer);
    },
  };
}
