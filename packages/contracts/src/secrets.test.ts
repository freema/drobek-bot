import { describe, expect, it } from "vitest";

import { masterKeySchema, secretNameSchema } from "./secrets.js";

/** 43 base64 characters and one pad: exactly 32 bytes. */
const WELL_FORMED_KEY = `${"A".repeat(43)}=`;

describe("masterKeySchema", () => {
  it("decodes a well-formed key to 32 bytes", () => {
    const key = masterKeySchema.parse(WELL_FORMED_KEY);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
  });

  it("rejects text that does not decode to 32 bytes", () => {
    expect(masterKeySchema.safeParse("c2hvcnQ=").success).toBe(false);
  });
});

describe("secretNameSchema", () => {
  it("accepts an environment variable name and rejects a lowercase one", () => {
    expect(secretNameSchema.safeParse("GITHUB_TOKEN").success).toBe(true);
    expect(secretNameSchema.safeParse("github_token").success).toBe(false);
  });
});
