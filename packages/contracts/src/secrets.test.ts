import { describe, expect, it } from "vitest";

import {
  AUTH_TAG_BYTES,
  ENCRYPTED_DATA_KEY_BYTES,
  MASTER_KEY_ID_PATTERN,
  NONCE_BYTES,
  masterKeySchema,
  secretEnvelopeSchema,
  secretNameSchema,
  secretScopeSchema,
} from "./secrets.js";

/** 43 base64 characters and one pad: exactly 32 bytes. */
const WELL_FORMED_KEY = `${"A".repeat(43)}=`;

/**
 * Valid standard base64 (all zero bytes; the content does not matter to
 * these tests) that decodes to exactly `byteLength` bytes. Built without
 * `Buffer` or any Node API, since `@drobek-bot/contracts` has no such
 * dependency and must typecheck without `@types/node`.
 */
function base64OfLength(byteLength: number): string {
  const fullGroups = Math.floor(byteLength / 3);
  const remainder = byteLength % 3;
  const tail = remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return "AAAA".repeat(fullGroups) + tail;
}

describe("masterKeySchema", () => {
  it("decodes a well-formed key to 32 bytes", () => {
    const key = masterKeySchema.parse(WELL_FORMED_KEY);
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.byteLength).toBe(32);
  });

  it("rejects text that does not decode to 32 bytes", () => {
    expect(masterKeySchema.safeParse("c2hvcnQ=").success).toBe(false);
  });

  it("decodes deterministic content, not just the right length", () => {
    const parsed = masterKeySchema.parse(base64OfLength(32));
    expect(Array.from(parsed).every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a key that decodes to 31 bytes", () => {
    expect(masterKeySchema.safeParse(base64OfLength(31)).success).toBe(false);
  });

  it("rejects a key that decodes to 33 bytes", () => {
    expect(masterKeySchema.safeParse(base64OfLength(33)).success).toBe(false);
  });

  it("rejects non-base64 text", () => {
    expect(masterKeySchema.safeParse("not base64 at all! @#%").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(masterKeySchema.safeParse("").success).toBe(false);
  });
});

describe("secretNameSchema", () => {
  it("accepts an environment variable name and rejects a lowercase one", () => {
    expect(secretNameSchema.safeParse("GITHUB_TOKEN").success).toBe(true);
    expect(secretNameSchema.safeParse("github_token").success).toBe(false);
  });

  it("accepts the shortest valid name, a single uppercase letter", () => {
    expect(secretNameSchema.safeParse("A").success).toBe(true);
  });

  it("rejects a name starting with a digit", () => {
    expect(secretNameSchema.safeParse("1TOKEN").success).toBe(false);
  });

  it("rejects a hyphen", () => {
    expect(secretNameSchema.safeParse("GITHUB-TOKEN").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(secretNameSchema.safeParse("").success).toBe(false);
  });

  it("accepts a name at the 64-character limit and rejects one character longer", () => {
    const atLimit = `A${"B".repeat(63)}`;
    const overLimit = `A${"B".repeat(64)}`;
    expect(atLimit).toHaveLength(64);
    expect(overLimit).toHaveLength(65);
    expect(secretNameSchema.safeParse(atLimit).success).toBe(true);
    expect(secretNameSchema.safeParse(overLimit).success).toBe(false);
  });
});

describe("secretEnvelopeSchema", () => {
  const base = {
    ciphertext: new Uint8Array(AUTH_TAG_BYTES),
    nonce: new Uint8Array(NONCE_BYTES),
    encryptedDataKey: new Uint8Array(ENCRYPTED_DATA_KEY_BYTES),
    keyId: "master-00000000",
  };

  it("accepts ciphertext at exactly the minimum length, the auth tag alone", () => {
    expect(secretEnvelopeSchema.safeParse(base).success).toBe(true);
  });

  it("rejects ciphertext shorter than the auth tag", () => {
    const tooShort = { ...base, ciphertext: new Uint8Array(AUTH_TAG_BYTES - 1) };
    expect(secretEnvelopeSchema.safeParse(tooShort).success).toBe(false);
  });

  it("rejects a nonce that is not exactly 12 bytes", () => {
    expect(
      secretEnvelopeSchema.safeParse({ ...base, nonce: new Uint8Array(NONCE_BYTES - 1) }).success,
    ).toBe(false);
    expect(
      secretEnvelopeSchema.safeParse({ ...base, nonce: new Uint8Array(NONCE_BYTES + 1) }).success,
    ).toBe(false);
  });

  it("rejects an encryptedDataKey that is not exactly 60 bytes", () => {
    expect(
      secretEnvelopeSchema.safeParse({
        ...base,
        encryptedDataKey: new Uint8Array(ENCRYPTED_DATA_KEY_BYTES - 1),
      }).success,
    ).toBe(false);
    expect(
      secretEnvelopeSchema.safeParse({
        ...base,
        encryptedDataKey: new Uint8Array(ENCRYPTED_DATA_KEY_BYTES + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects an empty keyId", () => {
    expect(secretEnvelopeSchema.safeParse({ ...base, keyId: "" }).success).toBe(false);
  });

  it("rejects an unknown key (strict object)", () => {
    expect(secretEnvelopeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("secretScopeSchema", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const botId = "22222222-2222-4222-8222-222222222222";

  it("accepts a workspace-level scope with botId null", () => {
    expect(
      secretScopeSchema.safeParse({ workspaceId, botId: null, name: "GITHUB_TOKEN" }).success,
    ).toBe(true);
  });

  it("accepts a bot-level scope", () => {
    expect(secretScopeSchema.safeParse({ workspaceId, botId, name: "GITHUB_TOKEN" }).success).toBe(
      true,
    );
  });

  it("rejects a non-uuid workspaceId", () => {
    expect(
      secretScopeSchema.safeParse({ workspaceId: "not-a-uuid", botId: null, name: "GITHUB_TOKEN" })
        .success,
    ).toBe(false);
  });

  it("rejects a scope whose name is not a valid secret name", () => {
    expect(
      secretScopeSchema.safeParse({ workspaceId, botId: null, name: "github_token" }).success,
    ).toBe(false);
  });
});

describe("MASTER_KEY_ID_PATTERN", () => {
  it("matches master- followed by exactly 8 lowercase hex characters", () => {
    expect(MASTER_KEY_ID_PATTERN.test("master-0123abcd")).toBe(true);
  });

  it("rejects uppercase hex, the wrong number of digits, and a missing prefix", () => {
    expect(MASTER_KEY_ID_PATTERN.test("master-0123ABCD")).toBe(false);
    expect(MASTER_KEY_ID_PATTERN.test("master-0123abc")).toBe(false);
    expect(MASTER_KEY_ID_PATTERN.test("master-0123abcde")).toBe(false);
    expect(MASTER_KEY_ID_PATTERN.test("0123abcd")).toBe(false);
  });
});
