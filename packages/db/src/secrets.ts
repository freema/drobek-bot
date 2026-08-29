import {
  secretEnvelopeSchema,
  secretScopeSchema,
  type SecretEnvelope,
  type SecretScope,
} from "@drobek-bot/contracts";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Db } from "./db.js";
import { secrets } from "./schema/index.js";

/**
 * The `secrets` table as a repository of envelopes. Sealing and opening happen
 * in the caller with `@drobek-bot/core`; nothing here ever sees a plaintext.
 */

/** The part of `Db` the repository uses; a transaction handle satisfies it too. */
export type SecretsDb = Pick<Db, "select" | "insert" | "delete">;

/** What a listing shows: never the envelope. */
export interface SecretSummary {
  readonly botId: string | null;
  readonly name: string;
  readonly keyId: string;
  readonly updatedAt: Date;
}

export interface ListSecretsFilter {
  readonly workspaceId: string;
  /** Omitted: every secret in the workspace; `null`: workspace-level only; an id: that bot's. */
  readonly botId?: string | null;
}

function whereScope(scope: SecretScope) {
  return and(
    eq(secrets.workspaceId, scope.workspaceId),
    scope.botId === null ? isNull(secrets.botId) : eq(secrets.botId, scope.botId),
    eq(secrets.name, scope.name),
  );
}

/** Inserts or replaces the envelope at `scope`; a replace touches `updated_at`. */
export async function putSecret(
  db: SecretsDb,
  scope: SecretScope,
  envelope: SecretEnvelope,
): Promise<void> {
  const { workspaceId, botId, name } = secretScopeSchema.parse(scope);
  const parsed = secretEnvelopeSchema.parse(envelope);
  const columns = {
    ciphertext: Buffer.from(parsed.ciphertext),
    encryptedDataKey: Buffer.from(parsed.encryptedDataKey),
    keyId: parsed.keyId,
    nonce: Buffer.from(parsed.nonce),
  };
  await db
    .insert(secrets)
    .values({ workspaceId, botId, name, ...columns })
    .onConflictDoUpdate({
      target: [secrets.workspaceId, secrets.botId, secrets.name],
      set: { ...columns, updatedAt: sql`now()` },
    });
}

/** The envelope at `scope`, or undefined when there is none. */
export async function getSecretEnvelope(
  db: SecretsDb,
  scope: SecretScope,
): Promise<SecretEnvelope | undefined> {
  const rows = await db
    .select({
      ciphertext: secrets.ciphertext,
      nonce: secrets.nonce,
      encryptedDataKey: secrets.encryptedDataKey,
      keyId: secrets.keyId,
    })
    .from(secrets)
    .where(whereScope(secretScopeSchema.parse(scope)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? undefined : secretEnvelopeSchema.parse(row);
}

/** Name, key id and last change of each secret in scope, by name; never the envelope. */
export async function listSecrets(
  db: SecretsDb,
  filter: ListSecretsFilter,
): Promise<SecretSummary[]> {
  const workspaceId = secretScopeSchema.shape.workspaceId.parse(filter.workspaceId);
  const botId =
    filter.botId === undefined ? undefined : secretScopeSchema.shape.botId.parse(filter.botId);
  const byBot =
    botId === undefined
      ? undefined
      : botId === null
        ? isNull(secrets.botId)
        : eq(secrets.botId, botId);
  return db
    .select({
      botId: secrets.botId,
      name: secrets.name,
      keyId: secrets.keyId,
      updatedAt: secrets.updatedAt,
    })
    .from(secrets)
    .where(and(eq(secrets.workspaceId, workspaceId), byBot))
    .orderBy(asc(secrets.name), asc(secrets.botId));
}

/** True when a row was removed. */
export async function deleteSecret(db: SecretsDb, scope: SecretScope): Promise<boolean> {
  const rows = await db
    .delete(secrets)
    .where(whereScope(secretScopeSchema.parse(scope)))
    .returning({ id: secrets.id });
  return rows.length > 0;
}
