import { describe, expect, it } from "vitest";

import { buildBoxEnv } from "./box-env.js";

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
