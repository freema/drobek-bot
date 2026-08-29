import { SECRET_NAME_PATTERN, type AuthMode } from "@drobek-bot/contracts";

/**
 * The environment a box receives: an allowlist built from what the bot asked
 * for, minus what must never cross into a box. Pure.
 */

/** Names that never reach a box, requested or not. */
export const BOX_ENV_DENIED_NAMES: readonly string[] = [
  "DATABASE_URL",
  "REDIS_URL",
  "DROBEK_MASTER_KEY",
  "GIT_SHA",
  "NODE_ENV",
  "PORT",
  "ANTHROPIC_AUTH_TOKEN",
];

/** Prefixes that never reach a box. */
export const BOX_ENV_DENIED_PREFIXES: readonly string[] = ["POSTGRES_", "CLAUDE_"];

/** Passes only for a bot authenticating with an API key, and only when requested. */
export const ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";

/** True when `name` is on the hard denylist, whatever the bot requested. */
export function isDeniedBoxEnvName(name: string): boolean {
  return (
    BOX_ENV_DENIED_NAMES.includes(name) ||
    BOX_ENV_DENIED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export interface BuildBoxEnvInput {
  /** The names the bot declares (`secrets` in `bot.yaml`, plus what the host adds for the run). */
  readonly requested: readonly string[];
  /** Name to plaintext, as opened from the store; only requested names are read from it. */
  readonly resolved: Readonly<Record<string, string>>;
  readonly authMode: AuthMode;
}

export interface BoxEnv {
  /** What the box gets. */
  readonly env: Readonly<Record<string, string>>;
  /** Requested, allowed, but not in `resolved`: the caller reports "secret not configured". */
  readonly missing: readonly string[];
  /** Requested but refused: on the denylist, not a valid secret name, or the API key outside `api_key` mode. */
  readonly denied: readonly string[];
}

/** Only requested names that resolve; the denylist wins over any request. */
export function buildBoxEnv({ requested, resolved, authMode }: BuildBoxEnvInput): BoxEnv {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  const denied: string[] = [];
  for (const name of new Set(requested)) {
    const refused =
      !SECRET_NAME_PATTERN.test(name) ||
      isDeniedBoxEnvName(name) ||
      (name === ANTHROPIC_API_KEY && authMode !== "api_key");
    if (refused) {
      denied.push(name);
      continue;
    }
    const value = Object.hasOwn(resolved, name) ? resolved[name] : undefined;
    if (value === undefined) {
      missing.push(name);
      continue;
    }
    env[name] = value;
  }
  return { env, missing, denied };
}
