import { randomBytes } from "node:crypto";

import {
  ENCRYPTED_DATA_KEY_BYTES,
  MASTER_KEY_ID_PATTERN,
  secretEnvelopeSchema,
  type SecretScope,
} from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import {
  SecretError,
  deriveKeyId,
  openSecret,
  openSecretText,
  parseMasterKey,
  scopeAad,
  sealSecret,
  type RandomSource,
  type SecretErrorKind,
} from "./envelope.js";

const kek = parseMasterKey(Buffer.alloc(32, 7).toString("base64"));
const scope: SecretScope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  botId: "22222222-2222-4222-8222-222222222222",
  name: "GITHUB_TOKEN",
};

/** Flips every bit of the byte at `index`, guaranteeing a change. */
function flipByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Buffer.from(bytes);
  const original = copy[index];
  if (original === undefined) throw new Error(`index ${index} out of range`);
  copy[index] = original ^ 0xff;
  return copy;
}

/** Runs `fn`, asserts it throws a `SecretError` of `kind`, and that the message never
 * contains any of `forbidden` (typically the plaintext or key material used in the test). */
function expectSecretError(
  fn: () => unknown,
  kind: SecretErrorKind,
  forbidden: readonly string[] = [],
): void {
  try {
    fn();
    throw new Error("expected fn to throw a SecretError");
  } catch (error) {
    if (!(error instanceof SecretError)) throw error;
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`secret cannot be opened: ${kind}`);
    for (const value of forbidden) {
      expect(error.message).not.toContain(value);
    }
  }
}

describe("sealSecret / openSecret: round trip", () => {
  it("opens what it sealed, in the same scope, under the derived key id", () => {
    const envelope = sealSecret({ kek, plaintext: "not-a-real-token-value", scope });
    expect(envelope.keyId).toBe(deriveKeyId(kek));
    expect(openSecretText({ kek, envelope, scope })).toBe("not-a-real-token-value");
  });

  const byteCases: ReadonlyArray<{ readonly label: string; readonly plaintext: Uint8Array }> = [
    { label: "empty", plaintext: new Uint8Array(0) },
    { label: "1 byte", plaintext: Uint8Array.from([0xab]) },
    { label: "multi-kilobyte", plaintext: randomBytes(5000) },
    { label: "non-ASCII UTF-8 bytes", plaintext: Buffer.from("Příliš žluťoučký kůň 🤖", "utf8") },
  ];

  for (const { label, plaintext } of byteCases) {
    it(`round-trips ${label} bytes exactly`, () => {
      const envelope = sealSecret({ kek, plaintext, scope });
      const opened = openSecret({ kek, envelope, scope });
      expect(Buffer.from(opened).equals(Buffer.from(plaintext))).toBe(true);
    });
  }

  const textCases: readonly string[] = [
    "",
    "a",
    "x".repeat(5000),
    "Příliš žluťoučký kůň 🤖 — non-ASCII with emoji and diacritics",
  ];

  for (const plaintext of textCases) {
    it(`round-trips text ${JSON.stringify(plaintext.slice(0, 20))}${plaintext.length > 20 ? "..." : ""} exactly`, () => {
      const envelope = sealSecret({ kek, plaintext, scope });
      expect(openSecretText({ kek, envelope, scope })).toBe(plaintext);
    });
  }
});

describe("sealSecret: envelope shape", () => {
  it("validates against secretEnvelopeSchema and has a 60-byte encryptedDataKey", () => {
    const envelope = sealSecret({ kek, plaintext: "check-schema", scope });
    expect(secretEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.encryptedDataKey.byteLength).toBe(ENCRYPTED_DATA_KEY_BYTES);
    expect(envelope.encryptedDataKey.byteLength).toBe(60);
  });

  it("never contains the plaintext verbatim in any envelope field", () => {
    const plaintext = "not-a-real-secret-value-with-enough-length-1234567890";
    const envelope = sealSecret({ kek, plaintext, scope });
    const needle = Buffer.from(plaintext, "utf8");
    expect(Buffer.from(envelope.ciphertext).includes(needle)).toBe(false);
    expect(Buffer.from(envelope.nonce).includes(needle)).toBe(false);
    expect(Buffer.from(envelope.encryptedDataKey).includes(needle)).toBe(false);
  });
});

describe("sealSecret: randomness", () => {
  it("produces different ciphertext, nonce and encryptedDataKey for two seals of the same plaintext", () => {
    const a = sealSecret({ kek, plaintext: "same-value", scope });
    const b = sealSecret({ kek, plaintext: "same-value", scope });
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.encryptedDataKey).equals(Buffer.from(b.encryptedDataKey))).toBe(false);
  });

  it("is reproducible with an injected deterministic random source", () => {
    function deterministicRandom(): RandomSource {
      let calls = 0;
      return (byteLength: number) => {
        calls += 1;
        return Buffer.alloc(byteLength, calls);
      };
    }

    const a = sealSecret({ kek, plaintext: "deterministic", scope, random: deterministicRandom() });
    const b = sealSecret({ kek, plaintext: "deterministic", scope, random: deterministicRandom() });

    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(true);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(true);
    expect(Buffer.from(a.encryptedDataKey).equals(Buffer.from(b.encryptedDataKey))).toBe(true);
    expect(a.keyId).toBe(b.keyId);
    expect(openSecretText({ kek, envelope: a, scope })).toBe("deterministic");
  });
});

describe("deriveKeyId", () => {
  it("is deterministic and matches the master-<8 hex> pattern", () => {
    expect(deriveKeyId(kek)).toBe(deriveKeyId(kek));
    expect(deriveKeyId(kek)).toMatch(MASTER_KEY_ID_PATTERN);
  });

  it("differs for different keys", () => {
    const otherKek = parseMasterKey(Buffer.alloc(32, 9).toString("base64"));
    expect(deriveKeyId(kek)).not.toBe(deriveKeyId(otherKek));
  });
});

describe("parseMasterKey", () => {
  it("accepts exactly 32 bytes of standard base64", () => {
    const raw = Buffer.alloc(32, 5);
    const key = parseMasterKey(raw.toString("base64"));
    expect(Buffer.from(key).equals(raw)).toBe(true);
  });

  it("rejects a key that decodes to fewer than 32 bytes", () => {
    expect(() => parseMasterKey(Buffer.alloc(31, 1).toString("base64"))).toThrow();
  });

  it("rejects a key that decodes to more than 32 bytes", () => {
    expect(() => parseMasterKey(Buffer.alloc(33, 1).toString("base64"))).toThrow();
  });

  it("rejects non-base64 text", () => {
    expect(() => parseMasterKey("not base64 at all! @#%")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => parseMasterKey("")).toThrow();
  });
});

describe("scopeAad", () => {
  it("joins workspaceId, botId and name with |", () => {
    expect(scopeAad(scope)).toBe(`${scope.workspaceId}|${scope.botId}|${scope.name}`);
  });

  it("renders a null botId as an empty segment", () => {
    const workspaceScope: SecretScope = { ...scope, botId: null };
    expect(scopeAad(workspaceScope)).toBe(`${scope.workspaceId}||${scope.name}`);
  });
});

describe("openSecret: tamper detection", () => {
  it("rejects a flipped byte in the ciphertext body as tampered", () => {
    const envelope = sealSecret({ kek, plaintext: "tamper-body-value", scope });
    const tampered = { ...envelope, ciphertext: flipByte(envelope.ciphertext, 0) };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "tampered", [
      "tamper-body-value",
    ]);
  });

  it("rejects a flipped byte in the ciphertext's auth tag region as tampered", () => {
    const envelope = sealSecret({ kek, plaintext: "tamper-tag-value", scope });
    const lastIndex = envelope.ciphertext.byteLength - 1;
    const tampered = { ...envelope, ciphertext: flipByte(envelope.ciphertext, lastIndex) };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "tampered", [
      "tamper-tag-value",
    ]);
  });

  it("rejects a flipped nonce byte as tampered", () => {
    const envelope = sealSecret({ kek, plaintext: "tamper-nonce-value", scope });
    const tampered = { ...envelope, nonce: flipByte(envelope.nonce, 0) };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "tampered", [
      "tamper-nonce-value",
    ]);
  });
});

describe("openSecret: a moved or modified encryptedDataKey reads as scope-mismatch", () => {
  it("rejects a flipped byte at the start of encryptedDataKey (the wrap nonce)", () => {
    const envelope = sealSecret({ kek, plaintext: "edk-nonce-value", scope });
    const tampered = { ...envelope, encryptedDataKey: flipByte(envelope.encryptedDataKey, 0) };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "scope-mismatch", [
      "edk-nonce-value",
    ]);
  });

  it("rejects a flipped byte at the end of encryptedDataKey (its auth tag)", () => {
    const envelope = sealSecret({ kek, plaintext: "edk-tag-value", scope });
    const lastIndex = envelope.encryptedDataKey.byteLength - 1;
    const tampered = {
      ...envelope,
      encryptedDataKey: flipByte(envelope.encryptedDataKey, lastIndex),
    };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "scope-mismatch", [
      "edk-tag-value",
    ]);
  });
});

describe("openSecret: scope mismatch", () => {
  const plaintext = "scoped-value";

  it("rejects opening under a different workspace", () => {
    const envelope = sealSecret({ kek, plaintext, scope });
    const otherScope: SecretScope = {
      ...scope,
      workspaceId: "99999999-9999-4999-8999-999999999999",
    };
    expectSecretError(() => openSecret({ kek, envelope, scope: otherScope }), "scope-mismatch", [
      plaintext,
    ]);
  });

  it("rejects opening under a different bot", () => {
    const envelope = sealSecret({ kek, plaintext, scope });
    const otherScope: SecretScope = { ...scope, botId: "88888888-8888-4888-8888-888888888888" };
    expectSecretError(() => openSecret({ kek, envelope, scope: otherScope }), "scope-mismatch", [
      plaintext,
    ]);
  });

  it("rejects opening at workspace level (botId null) when sealed for a bot", () => {
    const envelope = sealSecret({ kek, plaintext, scope });
    const otherScope: SecretScope = { ...scope, botId: null };
    expectSecretError(() => openSecret({ kek, envelope, scope: otherScope }), "scope-mismatch", [
      plaintext,
    ]);
  });

  it("rejects opening under a different name", () => {
    const envelope = sealSecret({ kek, plaintext, scope });
    const otherScope: SecretScope = { ...scope, name: "OTHER_NAME" };
    expectSecretError(() => openSecret({ kek, envelope, scope: otherScope }), "scope-mismatch", [
      plaintext,
    ]);
  });
});

describe("openSecret: wrong key", () => {
  it("rejects a different, correctly-sized master key, and the two keys derive different ids", () => {
    const otherKek = parseMasterKey(Buffer.alloc(32, 9).toString("base64"));
    expect(deriveKeyId(kek)).not.toBe(deriveKeyId(otherKek));

    const plaintext = "wrong-key-value";
    const envelope = sealSecret({ kek, plaintext, scope });
    expectSecretError(() => openSecret({ kek: otherKek, envelope, scope }), "wrong-key", [
      plaintext,
    ]);
  });
});

describe("openSecret: unsupported key id", () => {
  it("rejects a keyId that does not match master-<8 hex>", () => {
    const plaintext = "bad-key-id-value";
    const envelope = sealSecret({ kek, plaintext, scope });
    const tampered = { ...envelope, keyId: "not-a-real-key-id" };
    expectSecretError(() => openSecret({ kek, envelope: tampered, scope }), "unsupported-key-id", [
      plaintext,
    ]);
  });
});

describe("sealSecret / openSecret: master key of the wrong length", () => {
  it("throws a plain Error, not a SecretError, when the key is not 32 bytes", () => {
    const shortKek = Buffer.alloc(16, 1);
    const plaintextA = "wrong-length-kek-on-seal";
    const plaintextB = "wrong-length-kek-on-open";

    expect(() => sealSecret({ kek: shortKek, plaintext: plaintextA, scope })).toThrow(Error);
    try {
      sealSecret({ kek: shortKek, plaintext: plaintextA, scope });
      throw new Error("expected sealSecret to throw");
    } catch (error) {
      expect(error).not.toBeInstanceOf(SecretError);
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain(plaintextA);
      }
    }

    const envelope = sealSecret({ kek, plaintext: plaintextB, scope });
    try {
      openSecret({ kek: shortKek, envelope, scope });
      throw new Error("expected openSecret to throw");
    } catch (error) {
      expect(error).not.toBeInstanceOf(SecretError);
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain(plaintextB);
      }
    }
  });
});
