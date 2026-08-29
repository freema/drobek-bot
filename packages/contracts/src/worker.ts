/**
 * The worker's liveness signal, shared between the worker (writer) and the api
 * (reader). The key is refreshed every `intervalMs` with a `ttlSeconds` expiry;
 * the api reports the worker as `stale` when the key is gone.
 */
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;
