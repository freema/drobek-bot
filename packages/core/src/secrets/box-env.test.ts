import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_API_KEY,
  BOX_ENV_DENIED_NAMES,
  BOX_ENV_DENIED_PREFIXES,
  buildBoxEnv,
  isDeniedBoxEnvName,
} from "./box-env.js";

describe("buildBoxEnv", () => {
  it("passes a requested, resolved secret and denies an internal name even when requested", () => {
    const result = buildBoxEnv({
      requested: ["GITHUB_TOKEN", "DATABASE_URL"],
      resolved: { GITHUB_TOKEN: "value", DATABASE_URL: "postgres://internal" },
      authMode: "api_key",
    });
    expect(result).toEqual({
      env: { GITHUB_TOKEN: "value" },
      missing: [],
      denied: ["DATABASE_URL"],
    });
  });
});

describe("buildBoxEnv: the documented denylist", () => {
  it("matches exactly the documented names and prefixes", () => {
    expect([...BOX_ENV_DENIED_NAMES].sort()).toEqual(
      [
        "ANTHROPIC_AUTH_TOKEN",
        "DATABASE_URL",
        "DROBEK_MASTER_KEY",
        "GIT_SHA",
        "NODE_ENV",
        "PORT",
        "REDIS_URL",
      ].sort(),
    );
    expect([...BOX_ENV_DENIED_PREFIXES].sort()).toEqual(["CLAUDE_", "POSTGRES_"].sort());
  });

  it("isDeniedBoxEnvName recognises every documented name and prefix, and lets an ordinary name through", () => {
    for (const name of BOX_ENV_DENIED_NAMES) {
      expect(isDeniedBoxEnvName(name)).toBe(true);
    }
    expect(isDeniedBoxEnvName("POSTGRES_PASSWORD")).toBe(true);
    expect(isDeniedBoxEnvName("CLAUDE_CODE_OAUTH_TOKEN")).toBe(true);
    expect(isDeniedBoxEnvName("GITHUB_TOKEN")).toBe(false);
  });

  it("denies every documented name and prefix even when requested and present, and never puts it in env", () => {
    const requested = [...BOX_ENV_DENIED_NAMES, "POSTGRES_PASSWORD", "CLAUDE_CODE_OAUTH_TOKEN"];
    const resolved = Object.fromEntries(requested.map((name) => [name, `value-of-${name}`]));

    const result = buildBoxEnv({ requested, resolved, authMode: "api_key" });

    expect(result.env).toEqual({});
    expect([...result.denied].sort()).toEqual([...requested].sort());
    expect(result.missing).toEqual([]);
  });
});

describe("buildBoxEnv: requested but not resolved", () => {
  it("reports a requested, allowed name that has no value as missing", () => {
    const result = buildBoxEnv({
      requested: ["GITHUB_TOKEN"],
      resolved: {},
      authMode: "api_key",
    });
    expect(result).toEqual({ env: {}, missing: ["GITHUB_TOKEN"], denied: [] });
  });
});

describe("buildBoxEnv: the secret-name pattern", () => {
  it("denies a requested name that is not a valid secret name", () => {
    const result = buildBoxEnv({
      requested: ["github_token", "", "GITHUB-TOKEN", "1TOKEN"],
      resolved: {
        github_token: "x",
        "": "x",
        "GITHUB-TOKEN": "x",
        "1TOKEN": "x",
      },
      authMode: "api_key",
    });
    expect(result.env).toEqual({});
    expect([...result.denied].sort()).toEqual(
      ["", "1TOKEN", "GITHUB-TOKEN", "github_token"].sort(),
    );
    expect(result.missing).toEqual([]);
  });
});

describe("buildBoxEnv: ANTHROPIC_API_KEY", () => {
  it("passes it only when requested, present, and authMode is api_key", () => {
    const result = buildBoxEnv({
      requested: [ANTHROPIC_API_KEY],
      resolved: { [ANTHROPIC_API_KEY]: "sk-ant-value" },
      authMode: "api_key",
    });
    expect(result).toEqual({
      env: { [ANTHROPIC_API_KEY]: "sk-ant-value" },
      missing: [],
      denied: [],
    });
  });

  it("denies it under subscription mode, even when requested and present", () => {
    const result = buildBoxEnv({
      requested: [ANTHROPIC_API_KEY],
      resolved: { [ANTHROPIC_API_KEY]: "sk-ant-value" },
      authMode: "subscription",
    });
    expect(result).toEqual({ env: {}, missing: [], denied: [ANTHROPIC_API_KEY] });
  });

  it("is missing, not denied, under api_key mode when it is not requested at all", () => {
    const result = buildBoxEnv({
      requested: [],
      resolved: { [ANTHROPIC_API_KEY]: "sk-ant-value" },
      authMode: "api_key",
    });
    expect(result).toEqual({ env: {}, missing: [], denied: [] });
  });
});

describe("buildBoxEnv: duplicates in requested", () => {
  it("does not duplicate output for a name requested more than once", () => {
    const result = buildBoxEnv({
      requested: [
        "GITHUB_TOKEN",
        "GITHUB_TOKEN",
        "DATABASE_URL",
        "DATABASE_URL",
        "MISSING",
        "MISSING",
      ],
      resolved: { GITHUB_TOKEN: "value" },
      authMode: "api_key",
    });
    expect(result).toEqual({
      env: { GITHUB_TOKEN: "value" },
      missing: ["MISSING"],
      denied: ["DATABASE_URL"],
    });
  });
});

describe("buildBoxEnv: reads from resolved", () => {
  /** Wraps `entries` so every read of a present key is recorded in `reads`. */
  function trackedResolved(entries: Readonly<Record<string, string>>): {
    resolved: Readonly<Record<string, string>>;
    reads: string[];
  } {
    const reads: string[] = [];
    const resolved: Record<string, string> = {};
    for (const key of Object.keys(entries)) {
      const value = entries[key];
      if (value === undefined) continue;
      Object.defineProperty(resolved, key, {
        enumerable: true,
        get() {
          reads.push(key);
          return value;
        },
      });
    }
    return { resolved, reads };
  }

  it("never reads a resolved value for a denied, absent, or unrequested name", () => {
    const { resolved, reads } = trackedResolved({
      GITHUB_TOKEN: "gh-value",
      DATABASE_URL: "postgres://internal",
      [ANTHROPIC_API_KEY]: "sk-ant-value",
      UNREQUESTED_TOKEN: "never-should-be-touched",
    });

    const result = buildBoxEnv({
      requested: ["GITHUB_TOKEN", "DATABASE_URL", ANTHROPIC_API_KEY, "MISSING_NAME"],
      resolved,
      authMode: "subscription",
    });

    expect(result.env).toEqual({ GITHUB_TOKEN: "gh-value" });
    expect(reads).toEqual(["GITHUB_TOKEN"]);
  });
});
