import { createCipheriv, randomBytes } from "node:crypto";

import {
  DATA_KEY_BYTES,
  ENCRYPTED_DATA_KEY_BYTES,
  NONCE_BYTES,
  type SecretEnvelope,
  type SecretScope,
} from "@drobek-bot/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bots,
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

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

/** A minimal bot row; only its id and workspace matter to these tests. */
async function insertBot(tx: SecretsDb & Pick<Db, "insert">, workspaceId: string, slug: string) {
  return first(
    await tx
      .insert(bots)
      .values({
        workspaceId,
        name: "bot",
        slug,
        path: `/bots/${slug}`,
        model: "haiku",
        authMode: "api_key",
      })
      .returning(),
  );
}

/**
 * A real AES-256-GCM seal of `plaintext`, in the envelope's documented byte
 * layout, built with `node:crypto` directly (no dependency on
 * `@drobek-bot/core`, which this package does not depend on). The data key
 * is discarded after use; `encryptedDataKey` only needs to be the right
 * length here, since the repository never inspects it.
 */
function sealCanary(plaintext: string, keyId: string): SecretEnvelope {
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    ciphertext,
    nonce,
    encryptedDataKey: randomBytes(ENCRYPTED_DATA_KEY_BYTES),
    keyId,
  };
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

  it("deleteSecret returns true for the row it removed, then false for a second delete", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "delete-twice" }).returning(),
      );
      const scope = { workspaceId: workspace.id, botId: null, name: "DELETE_ME" };
      await putSecret(tx, scope, randomEnvelope("master-00000003"));

      expect(await deleteSecret(tx, scope)).toBe(true);
      expect(await deleteSecret(tx, scope)).toBe(false);
    });
  });

  it("deleteSecret on a scope that was never put returns false", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "delete-never-put" }).returning(),
      );
      const scope = { workspaceId: workspace.id, botId: null, name: "NEVER_PUT" };
      expect(await deleteSecret(tx, scope)).toBe(false);
    });
  });
});

describe("secrets repository: workspace-level and bot-level scopes coexist", () => {
  it("keeps a workspace-level and a bot-level secret with the same name as distinct rows", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "scope-coexist" }).returning(),
      );
      const bot = await insertBot(tx, workspace.id, "scope-coexist-bot");

      const workspaceScope: SecretScope = {
        workspaceId: workspace.id,
        botId: null,
        name: "SHARED",
      };
      const botScope: SecretScope = { workspaceId: workspace.id, botId: bot.id, name: "SHARED" };
      const workspaceEnvelope = randomEnvelope("master-11111111");
      const botEnvelope = randomEnvelope("master-22222222");

      await putSecret(tx, workspaceScope, workspaceEnvelope);
      await putSecret(tx, botScope, botEnvelope);

      const storedWorkspace = await getSecretEnvelope(tx, workspaceScope);
      const storedBot = await getSecretEnvelope(tx, botScope);
      if (storedWorkspace === undefined) throw new Error("workspace-level secret not found");
      if (storedBot === undefined) throw new Error("bot-level secret not found");
      expect(bytesEqual(storedWorkspace.ciphertext, workspaceEnvelope.ciphertext)).toBe(true);
      expect(bytesEqual(storedBot.ciphertext, botEnvelope.ciphertext)).toBe(true);
      expect(storedWorkspace.keyId).not.toBe(storedBot.keyId);

      const listed = await listSecrets(tx, { workspaceId: workspace.id });
      expect(listed).toHaveLength(2);
      expect(listed.some((entry) => entry.botId === null && entry.name === "SHARED")).toBe(true);
      expect(listed.some((entry) => entry.botId === bot.id && entry.name === "SHARED")).toBe(true);
    });
  });

  it("collapses two workspace-level puts of the same name to one row (NULLS NOT DISTINCT)", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "nulls-not-distinct" }).returning(),
      );
      const scope: SecretScope = { workspaceId: workspace.id, botId: null, name: "COLLAPSED" };

      await putSecret(tx, scope, randomEnvelope("master-aaaaaaaa"));
      await putSecret(tx, scope, randomEnvelope("master-bbbbbbbb"));

      const listed = await listSecrets(tx, { workspaceId: workspace.id, botId: null });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.keyId).toBe("master-bbbbbbbb");
    });
  });
});

describe("secrets repository: listSecrets", () => {
  it("never returns ciphertext or key material, only the summary fields", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "listsecrets-shape" }).returning(),
      );
      const scope: SecretScope = { workspaceId: workspace.id, botId: null, name: "SHAPE_CHECK" };
      await putSecret(tx, scope, randomEnvelope("master-cccccccc"));

      const listed = await listSecrets(tx, { workspaceId: workspace.id });
      const entry = first(listed);
      expect(Object.keys(entry).sort()).toEqual(["botId", "keyId", "name", "updatedAt"].sort());
    });
  });

  it("botId: null lists workspace-level secrets only; omitting botId lists both", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "listsecrets-filter" }).returning(),
      );
      const bot = await insertBot(tx, workspace.id, "listsecrets-filter-bot");

      await putSecret(
        tx,
        { workspaceId: workspace.id, botId: null, name: "WORKSPACE_LEVEL" },
        randomEnvelope("master-dddddddd"),
      );
      await putSecret(
        tx,
        { workspaceId: workspace.id, botId: bot.id, name: "BOT_LEVEL" },
        randomEnvelope("master-eeeeeeee"),
      );

      const workspaceOnly = await listSecrets(tx, { workspaceId: workspace.id, botId: null });
      expect(workspaceOnly.map((entry) => entry.name)).toEqual(["WORKSPACE_LEVEL"]);

      const both = await listSecrets(tx, { workspaceId: workspace.id });
      expect(both.map((entry) => entry.name).sort()).toEqual(["BOT_LEVEL", "WORKSPACE_LEVEL"]);
    });
  });
});

describe("secrets repository: deleting a bot cascades its secrets", () => {
  it("removes a bot's secret when the bot is deleted", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "cascade-workspace" }).returning(),
      );
      const bot = await insertBot(tx, workspace.id, "cascade-bot");
      const scope: SecretScope = { workspaceId: workspace.id, botId: bot.id, name: "CASCADE_ME" };
      await putSecret(tx, scope, randomEnvelope("master-ffffffff"));
      expect(await getSecretEnvelope(tx, scope)).toBeDefined();

      await tx.delete(bots).where(eq(bots.id, bot.id));

      expect(await getSecretEnvelope(tx, scope)).toBeUndefined();
    });
  });

  it("leaves a workspace-level secret alone when a bot in the same workspace is deleted", async () => {
    await withRollback(getDb(), async (tx) => {
      const workspace = first(
        await tx.insert(workspaces).values({ name: "cascade-sibling-workspace" }).returning(),
      );
      const bot = await insertBot(tx, workspace.id, "cascade-sibling-bot");
      const workspaceScope: SecretScope = {
        workspaceId: workspace.id,
        botId: null,
        name: "SURVIVES",
      };
      await putSecret(tx, workspaceScope, randomEnvelope("master-11112222"));

      await tx.delete(bots).where(eq(bots.id, bot.id));

      expect(await getSecretEnvelope(tx, workspaceScope)).toBeDefined();
    });
  });
});

describe("secrets repository: a real replace bumps updated_at", () => {
  it("gives the replaced row a later updated_at than the original", async () => {
    const database = getDb();
    const workspace = first(
      await database.insert(workspaces).values({ name: "bump-updated-at" }).returning(),
    );
    const scope: SecretScope = { workspaceId: workspace.id, botId: null, name: "BUMP_ME" };
    try {
      await putSecret(database, scope, randomEnvelope("master-00001111"));
      const before = first(await listSecrets(database, { workspaceId: workspace.id }));

      // Each `putSecret` is its own transaction, so `now()` differs between them
      // as long as they don't land in the same instant; the delay makes that certain.
      await new Promise((resolve) => setTimeout(resolve, 10));

      await putSecret(database, scope, randomEnvelope("master-00002222"));
      const after = first(await listSecrets(database, { workspaceId: workspace.id }));

      expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    } finally {
      await deleteSecret(database, scope);
      await database.delete(workspaces).where(eq(workspaces.id, workspace.id));
    }
  });
});

describe("secrets repository: plaintext never reaches the database", () => {
  it("does not appear in any textual or base64/hex rendering of the stored row", async () => {
    const database = getDb();
    try {
      await database.transaction(async (tx) => {
        const workspace = first(
          await tx.insert(workspaces).values({ name: "canary-workspace" }).returning(),
        );
        const scope: SecretScope = {
          workspaceId: workspace.id,
          botId: null,
          name: "CANARY_SECRET",
        };
        const canary = `drobek-canary-${randomBytes(8).toString("hex")}`;
        await putSecret(tx, scope, sealCanary(canary, "master-cafebabe"));

        const result = await tx.execute(sql`
          select
            workspace_id, bot_id, name, key_id, created_at, updated_at,
            encode(ciphertext, 'escape') as ciphertext_escape,
            encode(ciphertext, 'hex') as ciphertext_hex,
            encode(ciphertext, 'base64') as ciphertext_base64,
            encode(nonce, 'escape') as nonce_escape,
            encode(nonce, 'hex') as nonce_hex,
            encode(nonce, 'base64') as nonce_base64,
            encode(encrypted_data_key, 'escape') as encrypted_data_key_escape,
            encode(encrypted_data_key, 'hex') as encrypted_data_key_hex,
            encode(encrypted_data_key, 'base64') as encrypted_data_key_base64
          from secrets
          where workspace_id = ${workspace.id} and name = ${scope.name}
        `);
        const row = first(result.rows);

        for (const value of Object.values(row)) {
          expect(String(value)).not.toContain(canary);
        }

        tx.rollback();
      });
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) throw error;
    }
  });
});
