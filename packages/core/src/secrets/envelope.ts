import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import {
  AUTH_TAG_BYTES,
  DATA_KEY_BYTES,
  MASTER_KEY_BYTES,
  MASTER_KEY_ID_PATTERN,
  NONCE_BYTES,
  masterKeySchema,
  secretEnvelopeSchema,
  type MasterKey,
  type SecretEnvelope,
  type SecretScope,
} from "@drobek-bot/contracts";

/**
 * Envelope encryption for the secret store. Every secret gets its own data
 * key (DEK); the data key is wrapped under the master key (KEK) from
 * `DROBEK_MASTER_KEY`. Both layers are AES-256-GCM with the scope as
 * additional authenticated data, so an envelope moved to another workspace,
 * bot or name does not open. Pure apart from `node:crypto`, which computes.
 *
 * Layout, column for column:
 * - `ciphertext`       = GCM(DEK, nonce, AAD)(plaintext) ‖ tag (16 bytes)
 * - `nonce`            = 12 random bytes, stored on its own
 * - `encryptedDataKey` = wrapNonce (12) ‖ GCM(KEK, wrapNonce, AAD)(DEK) (32) ‖ tag (16)
 * - `keyId`            = `master-` + first 8 hex characters of SHA-256(KEK)
 */

const ALGORITHM = "aes-256-gcm";

/** Why an envelope did not open; never carries key or secret material. */
export type SecretErrorKind = "wrong-key" | "tampered" | "scope-mismatch" | "unsupported-key-id";

export class SecretError extends Error {
  readonly kind: SecretErrorKind;

  constructor(kind: SecretErrorKind) {
    super(`secret cannot be opened: ${kind}`);
    this.name = "SecretError";
    this.kind = kind;
  }
}

/** Returns exactly `byteLength` fresh random bytes. */
export type RandomSource = (byteLength: number) => Uint8Array;

/** The production source: `node:crypto` `randomBytes`. */
export const defaultRandom: RandomSource = (byteLength) => randomBytes(byteLength);

/** `DROBEK_MASTER_KEY` text to the 32 raw key bytes; throws on anything else. */
export function parseMasterKey(text: string): MasterKey {
  return masterKeySchema.parse(text);
}

/** `master-` and the first 8 hex characters of SHA-256 over the key bytes. */
export function deriveKeyId(kek: Uint8Array): string {
  return `master-${createHash("sha256").update(kek).digest("hex").slice(0, 8)}`;
}

/** The additional authenticated data that binds an envelope to its row. */
export function scopeAad(scope: SecretScope): string {
  return `${scope.workspaceId}|${scope.botId ?? ""}|${scope.name}`;
}

function assertMasterKey(kek: Uint8Array): void {
  if (kek.byteLength !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes, got ${kek.byteLength}`);
  }
}

function take(random: RandomSource, byteLength: number): Uint8Array {
  const bytes = random(byteLength);
  if (bytes.byteLength !== byteLength) {
    throw new Error(`random source returned ${bytes.byteLength} bytes, expected ${byteLength}`);
  }
  return bytes;
}

function encrypt(key: Uint8Array, nonce: Uint8Array, aad: Buffer, plaintext: Uint8Array): Buffer {
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Undefined when the tag does not verify: wrong key, wrong AAD or modified bytes. */
function decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Buffer,
  sealed: Uint8Array,
): Buffer | undefined {
  if (sealed.byteLength < AUTH_TAG_BYTES) return undefined;
  const body = sealed.subarray(0, sealed.byteLength - AUTH_TAG_BYTES);
  const tag = sealed.subarray(sealed.byteLength - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return undefined;
  }
}

export interface SealSecretInput {
  readonly kek: Uint8Array;
  /** A string is stored as UTF-8. */
  readonly plaintext: Uint8Array | string;
  readonly scope: SecretScope;
  /** Injected for deterministic tests; draws, in order: the data key, the nonce, the wrap nonce. */
  readonly random?: RandomSource;
}

/** Seals `plaintext` for `scope` under a fresh data key wrapped with `kek`. */
export function sealSecret({
  kek,
  plaintext,
  scope,
  random = defaultRandom,
}: SealSecretInput): SecretEnvelope {
  assertMasterKey(kek);
  const aad = Buffer.from(scopeAad(scope), "utf8");
  const dek = take(random, DATA_KEY_BYTES);
  const nonce = take(random, NONCE_BYTES);
  const wrapNonce = take(random, NONCE_BYTES);
  const bytes = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  return {
    ciphertext: encrypt(dek, nonce, aad, bytes),
    nonce,
    encryptedDataKey: Buffer.concat([wrapNonce, encrypt(kek, wrapNonce, aad, dek)]),
    keyId: deriveKeyId(kek),
  };
}

export interface OpenSecretInput {
  readonly kek: Uint8Array;
  readonly envelope: SecretEnvelope;
  readonly scope: SecretScope;
}

/**
 * The plaintext bytes of `envelope` for `scope`, or a `SecretError`:
 * - `tampered` when the envelope does not have the documented layout, or when
 *   the data key unwrapped but the ciphertext or nonce do not authenticate;
 * - `unsupported-key-id` when `keyId` is not a `master-` id this code knows;
 * - `wrong-key` when `keyId` names a different master key than `kek`;
 * - `scope-mismatch` when the data key does not unwrap for this scope under
 *   the named master key: the row was moved to another workspace, bot or
 *   name, or its `encryptedDataKey` was modified (GCM cannot tell these apart).
 */
export function openSecret({ kek, envelope, scope }: OpenSecretInput): Uint8Array {
  assertMasterKey(kek);
  const parsed = secretEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new SecretError("tampered");
  const { ciphertext, nonce, encryptedDataKey, keyId } = parsed.data;
  if (!MASTER_KEY_ID_PATTERN.test(keyId)) throw new SecretError("unsupported-key-id");
  if (keyId !== deriveKeyId(kek)) throw new SecretError("wrong-key");
  const aad = Buffer.from(scopeAad(scope), "utf8");
  const dek = decrypt(
    kek,
    encryptedDataKey.subarray(0, NONCE_BYTES),
    aad,
    encryptedDataKey.subarray(NONCE_BYTES),
  );
  if (dek === undefined) throw new SecretError("scope-mismatch");
  const plaintext = decrypt(dek, nonce, aad, ciphertext);
  if (plaintext === undefined) throw new SecretError("tampered");
  return plaintext;
}

/** `openSecret` for a secret that was sealed from a string; the bytes must be valid UTF-8. */
export function openSecretText(input: OpenSecretInput): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(openSecret(input));
}
