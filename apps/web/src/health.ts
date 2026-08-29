import { healthResponseSchema } from "@drobek-bot/contracts";
import type { HealthResponse } from "@drobek-bot/contracts";

export type HealthState =
  { kind: "loading" } | { kind: "unreachable" } | { kind: "ready"; health: HealthResponse };

export const HEALTH_URL = "/api/health";

type FetchLike = (url: string) => Promise<Response>;

/**
 * Reads the api's health. Any failure (network, non-JSON body, unexpected
 * shape) is reported as unreachable; a 503 with a valid body is still "ready".
 */
export async function fetchHealth(
  fetchImpl: FetchLike = (url) => fetch(url),
): Promise<HealthState> {
  try {
    const response = await fetchImpl(HEALTH_URL);
    const parsed = healthResponseSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", health: parsed.data } : { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

/** Pure: the one-line status shown under the wordmark. */
export function formatStatusLine(state: HealthState): string {
  switch (state.kind) {
    case "loading":
      return "api: checking";
    case "unreachable":
      return "api: unreachable";
    case "ready": {
      const { version, commit, status, checks } = state.health;
      return `api ${version} (${commit}) ${status}: postgres ${checks.postgres}, redis ${checks.redis}, worker ${checks.worker}`;
    }
  }
}
