import { randomBytes } from "node:crypto";

import type { SecretEnvelope } from "@drobek-bot/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { TransactionRollbackError } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDb,
  deleteSecret,
  getSecretEnvelope,
  listSecrets,
  migrate,
  putSecret,
  workspaces,
  type Db,
  type SecretsDb,
} from "./index.js";

let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;
let db: Db | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  db = createDb(pool);
  await migrate(db);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

function getDb(): Db {
  if (!db) throw new Error("database not started");
  return db;
}

/** Runs `fn` in a transaction that is always rolled back, so nothing survives the test. */
async function withRollback(
  database: Db,
  fn: (tx: SecretsDb & Pick<Db, "insert">) => Promise<void>,
): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

/** Random bytes in the documented layout; the repository never inspects them. */
function randomEnvelope(keyId: string): SecretEnvelope {
  return {
    ciphertext: randomBytes(40),
    nonce: randomBytes(12),
    encryptedDataKey: randomBytes(60),
    keyId,
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

describe("secrets repository", () => {
  it("put then get returns the same bytes, a second put replaces them, delete removes the row", async () => {
    await withRollback(getDb(), async (tx) => {
      const [workspace] = await tx.insert(workspaces).values({ name: "secrets-smoke" }).returning();
      if (workspace === undefined) throw new Error("workspace not inserted");
      const scope = { workspaceId: workspace.id, botId: null, name: "GITHUB_TOKEN" };

      await putSecret(tx, scope, randomEnvelope("master-00000001"));
      const replacement = randomEnvelope("master-00000002");
      await putSecret(tx, scope, replacement);

      const stored = await getSecretEnvelope(tx, scope);
      if (stored === undefined) throw new Error("secret not found after put");
      expect(bytesEqual(stored.ciphertext, replacement.ciphertext)).toBe(true);
      expect(bytesEqual(stored.nonce, replacement.nonce)).toBe(true);
      expect(bytesEqual(stored.encryptedDataKey, replacement.encryptedDataKey)).toBe(true);
      expect(stored.keyId).toBe("master-00000002");

      const listed = await listSecrets(tx, { workspaceId: workspace.id });
      expect(listed.map((entry) => [entry.botId, entry.name, entry.keyId])).toEqual([
        [null, "GITHUB_TOKEN", "master-00000002"],
      ]);

      expect(await deleteSecret(tx, scope)).toBe(true);
      expect(await getSecretEnvelope(tx, scope)).toBeUndefined();
    });
  });
});
