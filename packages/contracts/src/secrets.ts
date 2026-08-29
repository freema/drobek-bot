import { z } from "zod";

/**
 * The secret store's boundary types: secret names, the master key, the
 * envelope one row of the `secrets` table holds, and the scope a secret is
 * bound to. The cryptography lives in `@drobek-bot/core`; these schemas are
 * what every side of it validates against.
 */

/** An environment variable name: uppercase, digits and underscores, 1-64 characters. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export const secretNameSchema = z.string().regex(SECRET_NAME_PATTERN, {
  error: "expected an uppercase name such as GITHUB_TOKEN (letters, digits, underscores)",
});
export type SecretName = z.infer<typeof secretNameSchema>;

/** Sizes fixed by the envelope format; a change here is a new key id scheme. */
export const MASTER_KEY_BYTES = 32;
export const DATA_KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const AUTH_TAG_BYTES = 16;
/** `encrypted_data_key` = wrap nonce, the wrapped data key, the auth tag. */
export const ENCRYPTED_DATA_KEY_BYTES = NONCE_BYTES + DATA_KEY_BYTES + AUTH_TAG_BYTES;

/** `master-` and the first 8 hex characters of SHA-256 over the master key bytes. */
export const MASTER_KEY_ID_PATTERN = /^master-[0-9a-f]{8}$/;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Strict standard base64 (RFC 4648, `+` and `/`, optional `=` padding), without
 * a runtime dependency so the schema works in the browser as well as in Node.
 * Returns undefined for anything that is not well-formed.
 */
function decodeBase64(text: string): Uint8Array | undefined {
  if (!BASE64_PATTERN.test(text)) return undefined;
  const body = text.replace(/=+$/, "");
  if (body.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let out = 0;
  for (const char of body) {
    value = (value << 6) | BASE64_ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (value >> bits) & 0xff;
      out += 1;
    }
  }
  return bytes;
}

const MASTER_KEY_HINT = `expected ${MASTER_KEY_BYTES} random bytes as base64 (openssl rand -base64 ${MASTER_KEY_BYTES})`;

/** `DROBEK_MASTER_KEY`: base64 text that decodes to exactly 32 bytes; the output is the raw key. */
export const masterKeySchema = z.string().transform((text, ctx) => {
  const bytes = decodeBase64(text.trim());
  if (bytes === undefined || bytes.byteLength !== MASTER_KEY_BYTES) {
    ctx.addIssue({ code: "custom", message: MASTER_KEY_HINT });
    return z.NEVER;
  }
  return bytes;
});
export type MasterKey = z.infer<typeof masterKeySchema>;

/** Any `Uint8Array`, a Node `Buffer` included (its buffer may be shared, which `z.instanceof` would type away). */
const bytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
  error: "expected bytes",
});

/** The encrypted form of one secret, column for column what the `secrets` table stores. */
export const secretEnvelopeSchema = z.strictObject({
  /** AES-256-GCM under the data key, the auth tag appended. */
  ciphertext: bytesSchema.refine((bytes) => bytes.byteLength >= AUTH_TAG_BYTES, {
    error: `expected at least ${AUTH_TAG_BYTES} bytes`,
  }),
  nonce: bytesSchema.refine((bytes) => bytes.byteLength === NONCE_BYTES, {
    error: `expected ${NONCE_BYTES} bytes`,
  }),
  /** The wrap nonce, then the data key under the master key, then the auth tag. */
  encryptedDataKey: bytesSchema.refine((bytes) => bytes.byteLength === ENCRYPTED_DATA_KEY_BYTES, {
    error: `expected ${ENCRYPTED_DATA_KEY_BYTES} bytes`,
  }),
  /** Names the master key that wrapped the data key; the format is decided by the vault. */
  keyId: z.string().min(1),
});
export type SecretEnvelope = z.infer<typeof secretEnvelopeSchema>;

/** Where a secret lives: a workspace, optionally one bot in it, and its name. */
export const secretScopeSchema = z.strictObject({
  workspaceId: z.uuid(),
  botId: z.uuid().nullable(),
  name: secretNameSchema,
});
export type SecretScope = z.infer<typeof secretScopeSchema>;
