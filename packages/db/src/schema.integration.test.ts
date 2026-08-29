import { randomBytes } from "node:crypto";

import {
  ACTOR_TYPES,
  APPROVAL_DECISIONS,
  APPROVAL_RULE_DECISIONS,
  AUTH_MODES,
  MESSAGE_ROLES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  TASK_SOURCES,
  THREAD_KINDS,
  USER_ROLES,
} from "@drobek-bot/contracts";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql, TransactionRollbackError } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approvals,
  attempts,
  auditEvents,
  bots,
  createDb,
  events,
  messages,
  migrate,
  routines,
  runs,
  secrets,
  tasks,
  threads,
  users,
  workspaces,
  type Db,
} from "./index.js";

/**
 * One container for the whole file: `migrate` runs once in `beforeAll`, and
 * every test that mutates data runs inside its own Postgres transaction that
 * is always rolled back (either because the statement under test was
 * expected to fail, or explicitly via `withRollback`), so tests never depend
 * on execution order and never depend on each other's state.
 */

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

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

/** The subset of `Db` that both `Db` itself and a transaction handle satisfy. */
type Query = Pick<Db, "insert" | "select" | "update" | "delete" | "execute">;

/**
 * Runs `fn` inside a transaction and always rolls it back, even on success:
 * every insert `fn` makes is gone once this resolves, so tests that need to
 * assert on state without keeping it around can just call this.
 */
async function withRollback(database: Db, fn: (tx: Query) => Promise<void>): Promise<void> {
  try {
    await database.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

/**
 * Awaits a promise expected to reject and returns the most specific message
 * available: drizzle wraps the driver error as `DrizzleQueryError` (whose own
 * `.message` is just "Failed query: ..."), with the real Postgres message on
 * `.cause`.
 */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error.cause instanceof Error ? error.cause.message : error.message;
    }
    return String(error);
  }
  throw new Error("expected the promise to reject, but it resolved");
}

// --- fixtures -------------------------------------------------------------

async function insertWorkspace(tx: Query, name: string) {
  return first(await tx.insert(workspaces).values({ name }).returning());
}

async function insertUser(tx: Query, workspaceId: string, email: string) {
  return first(await tx.insert(users).values({ workspaceId, email, role: "member" }).returning());
}

async function insertBot(tx: Query, workspaceId: string, slug: string) {
  return first(
    await tx
      .insert(bots)
      .values({
        workspaceId,
        name: "bot",
        slug,
        path: "/bots/bot",
        model: "haiku",
        authMode: "api_key",
      })
      .returning(),
  );
}

async function insertThread(tx: Query, botId: string, title: string) {
  return first(await tx.insert(threads).values({ botId, kind: "chat", title }).returning());
}

async function insertTask(tx: Query, botId: string, threadId: string | null, title: string) {
  return first(
    await tx.insert(tasks).values({ botId, threadId, title, source: "chat" }).returning(),
  );
}

async function insertRun(tx: Query, taskId: string, botId: string, threadId: string) {
  return first(
    await tx.insert(runs).values({ taskId, botId, threadId, trigger: "chat" }).returning(),
  );
}

/** workspace -> bot -> thread -> task -> run, all named from `label` so parallel fixtures never collide. */
async function insertChain(tx: Query, label: string) {
  const workspace = await insertWorkspace(tx, `${label}-workspace`);
  const bot = await insertBot(tx, workspace.id, `${label}-bot`);
  const thread = await insertThread(tx, bot.id, `${label}-thread`);
  const task = await insertTask(tx, bot.id, thread.id, `${label}-task`);
  const run = await insertRun(tx, task.id, bot.id, thread.id);
  return { workspace, bot, thread, task, run };
}

async function insertEvent(tx: Query, runId: string, threadId: string, seq: number) {
  return first(
    await tx
      .insert(events)
      .values({ runId, threadId, seq, type: "test.event", payload: {} })
      .returning(),
  );
}

async function insertAttempt(tx: Query, runId: string, number: number) {
  return first(await tx.insert(attempts).values({ runId, number, status: "pending" }).returning());
}

async function insertMessage(tx: Query, threadId: string) {
  return first(
    await tx
      .insert(messages)
      .values({ threadId, runId: null, role: "user", content: {} })
      .returning(),
  );
}

async function insertAuditEvent(tx: Query, workspaceId: string) {
  return first(
    await tx
      .insert(auditEvents)
      .values({
        workspaceId,
        actorType: "user",
        actorId: "actor-1",
        action: "test.action",
        targetType: "bot",
        targetId: "target-1",
        payloadHash: "hash",
      })
      .returning(),
  );
}

// --- tables -----------------------------------------------------------------

const EXPECTED_TABLES = [
  "approval_rules",
  "approvals",
  "attempts",
  "audit_events",
  "bots",
  "events",
  "messages",
  "routines",
  "runs",
  "secrets",
  "tasks",
  "threads",
  "usage_records",
  "users",
  "workspaces",
];

describe("migrated schema", () => {
  it("creates exactly the expected tables in public", async () => {
    const database = getDb();
    const result = await database.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const tableNames = result.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(EXPECTED_TABLES);
  });

  it("is a no-op the second time it runs", async () => {
    const database = getDb();
    const before = await database.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    await expect(migrate(database)).resolves.toBeUndefined();
    const after = await database.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(after.rows[0]?.count).toEqual(before.rows[0]?.count);
  });

  const ENUM_PAIRS: ReadonlyArray<{
    readonly pgName: string;
    readonly expected: readonly string[];
  }> = [
    { pgName: "run_status", expected: RUN_STATUSES },
    { pgName: "run_trigger", expected: RUN_TRIGGERS },
    { pgName: "task_source", expected: TASK_SOURCES },
    { pgName: "approval_decision", expected: APPROVAL_DECISIONS },
    { pgName: "approval_rule_decision", expected: APPROVAL_RULE_DECISIONS },
    { pgName: "auth_mode", expected: AUTH_MODES },
    { pgName: "thread_kind", expected: THREAD_KINDS },
    { pgName: "message_role", expected: MESSAGE_ROLES },
    { pgName: "user_role", expected: USER_ROLES },
    { pgName: "actor_type", expected: ACTOR_TYPES },
  ];

  for (const { pgName, expected } of ENUM_PAIRS) {
    it(`enum ${pgName} matches the contracts array`, async () => {
      const database = getDb();
      const result = await database.execute(
        sql`select e.enumlabel from pg_enum e join pg_type t on e.enumtypid = t.oid where t.typname = ${pgName} order by e.enumsortorder`,
      );
      const labels = result.rows.map((row) => row.enumlabel);
      expect(labels).toEqual([...expected]);
    });
  }
});

// --- defaults -----------------------------------------------------------------

describe("column defaults", () => {
  it("a new run defaults to pending with lease_fence 0", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const { run } = await insertChain(tx, "defaults-run");
      expect(run.status).toBe("pending");
      expect(run.leaseFence).toBe(0);
      expect(run.createdAt).toBeInstanceOf(Date);
    });
  });

  it("a new routine defaults to inactive with the Europe/Prague timezone", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const workspace = await insertWorkspace(tx, "defaults-routine-workspace");
      const bot = await insertBot(tx, workspace.id, "defaults-routine-bot");
      const routine = first(
        await tx
          .insert(routines)
          .values({ botId: bot.id, name: "routine", prompt: "do the thing", crons: ["0 * * * *"] })
          .returning(),
      );
      expect(routine.active).toBe(false);
      expect(routine.timezone).toBe("Europe/Prague");
      expect(routine.createdAt).toBeInstanceOf(Date);
    });
  });
});

// --- uniqueness -----------------------------------------------------------------

describe("uniqueness", () => {
  it("rejects two bots with the same slug in one workspace", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "dup-slug-workspace");
        await insertBot(tx, workspace.id, "same-slug");
        await insertBot(tx, workspace.id, "same-slug");
      }),
    ).rejects.toThrow();
  });

  it("allows the same slug in different workspaces", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const workspaceA = await insertWorkspace(tx, "slug-ws-a");
      const workspaceB = await insertWorkspace(tx, "slug-ws-b");
      const botA = await insertBot(tx, workspaceA.id, "shared-slug");
      const botB = await insertBot(tx, workspaceB.id, "shared-slug");
      expect(botA.slug).toBe(botB.slug);
      expect(botA.workspaceId).not.toBe(botB.workspaceId);
    });
  });

  it("rejects two events with the same (run_id, seq)", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const { run, thread } = await insertChain(tx, "dup-event-seq");
        await insertEvent(tx, run.id, thread.id, 1);
        await insertEvent(tx, run.id, thread.id, 1);
      }),
    ).rejects.toThrow();
  });

  it("rejects two attempts with the same (run_id, number)", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const { run } = await insertChain(tx, "dup-attempt-number");
        await insertAttempt(tx, run.id, 1);
        await insertAttempt(tx, run.id, 1);
      }),
    ).rejects.toThrow();
  });

  it("rejects two workspace-level secrets with the same name in one workspace (NULLS NOT DISTINCT)", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "dup-secret-workspace");
        const values = {
          workspaceId: workspace.id,
          botId: null,
          name: "shared-secret",
          ciphertext: randomBytes(8),
          encryptedDataKey: randomBytes(8),
          keyId: "key-1",
          nonce: randomBytes(8),
        };
        await tx.insert(secrets).values(values).returning();
        await tx.insert(secrets).values(values).returning();
      }),
    ).rejects.toThrow();
  });

  it("rejects two users with the same email", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "dup-user-email-workspace");
        await insertUser(tx, workspace.id, "duplicate@example.com");
        await insertUser(tx, workspace.id, "duplicate@example.com");
      }),
    ).rejects.toThrow();
  });
});

// --- append-only -----------------------------------------------------------------

describe("append-only: events", () => {
  it("rejects UPDATE", async () => {
    const database = getDb();
    const message = await rejectionMessage(
      database.transaction(async (tx) => {
        const { run, thread } = await insertChain(tx, "events-update");
        const event = await insertEvent(tx, run.id, thread.id, 1);
        await tx.update(events).set({ type: "changed" }).where(eq(events.id, event.id));
      }),
    );
    expect(message).toMatch(/is not allowed/i);
  });

  it("rejects TRUNCATE", async () => {
    const database = getDb();
    const message = await rejectionMessage(
      database.transaction(async (tx) => {
        const { run, thread } = await insertChain(tx, "events-truncate");
        await insertEvent(tx, run.id, thread.id, 1);
        await tx.execute(sql`truncate table events`);
      }),
    );
    expect(message).toMatch(/is not allowed/i);
  });

  it("allows DELETE, and deleting a run removes its events through the cascade", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const { run, thread } = await insertChain(tx, "events-cascade-run");
      await insertEvent(tx, run.id, thread.id, 1);

      await tx.delete(runs).where(eq(runs.id, run.id));

      const remaining = await tx.select().from(events).where(eq(events.runId, run.id));
      expect(remaining).toEqual([]);
    });
  });

  it("deleting a bot cascades through threads, tasks, runs and events", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const { bot, thread, task, run } = await insertChain(tx, "events-cascade-bot");
      await insertEvent(tx, run.id, thread.id, 1);

      await tx.delete(bots).where(eq(bots.id, bot.id));

      const remainingThreads = await tx.select().from(threads).where(eq(threads.id, thread.id));
      const remainingTasks = await tx.select().from(tasks).where(eq(tasks.id, task.id));
      const remainingRuns = await tx.select().from(runs).where(eq(runs.id, run.id));
      const remainingEvents = await tx.select().from(events).where(eq(events.runId, run.id));
      expect(remainingThreads).toEqual([]);
      expect(remainingTasks).toEqual([]);
      expect(remainingRuns).toEqual([]);
      expect(remainingEvents).toEqual([]);
    });
  });
});

describe("append-only: audit_events", () => {
  it("rejects UPDATE", async () => {
    const database = getDb();
    const message = await rejectionMessage(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "audit-update-workspace");
        const auditEvent = await insertAuditEvent(tx, workspace.id);
        await tx
          .update(auditEvents)
          .set({ action: "changed" })
          .where(eq(auditEvents.id, auditEvent.id));
      }),
    );
    expect(message).toMatch(/is not allowed/i);
  });

  it("rejects DELETE", async () => {
    const database = getDb();
    const message = await rejectionMessage(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "audit-delete-workspace");
        const auditEvent = await insertAuditEvent(tx, workspace.id);
        await tx.delete(auditEvents).where(eq(auditEvents.id, auditEvent.id));
      }),
    );
    expect(message).toMatch(/is not allowed/i);
  });

  it("rejects TRUNCATE", async () => {
    const database = getDb();
    const message = await rejectionMessage(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "audit-truncate-workspace");
        await insertAuditEvent(tx, workspace.id);
        await tx.execute(sql`truncate table audit_events`);
      }),
    );
    expect(message).toMatch(/is not allowed/i);
  });
});

// --- referential actions -----------------------------------------------------------------

describe("referential actions", () => {
  it("rejects deleting a workspace that still has a bot", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "restrict-bot-workspace");
        await insertBot(tx, workspace.id, "restrict-bot");
        await tx.delete(workspaces).where(eq(workspaces.id, workspace.id));
      }),
    ).rejects.toThrow();
  });

  it("rejects deleting a workspace that still has a user", async () => {
    const database = getDb();
    await expect(
      database.transaction(async (tx) => {
        const workspace = await insertWorkspace(tx, "restrict-user-workspace");
        await insertUser(tx, workspace.id, "restrict-user@example.com");
        await tx.delete(workspaces).where(eq(workspaces.id, workspace.id));
      }),
    ).rejects.toThrow();
  });

  it("deleting a user sets approvals.decided_by to null", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const { workspace, run } = await insertChain(tx, "approval-decider");
      const decider = await insertUser(tx, workspace.id, "decider@example.com");
      const approval = first(
        await tx
          .insert(approvals)
          .values({
            runId: run.id,
            tool: "bash",
            input: {},
            decidedBy: decider.id,
            expiresAt: new Date(Date.now() + 60_000),
          })
          .returning(),
      );

      await tx.delete(users).where(eq(users.id, decider.id));

      const reloaded = first(
        await tx.select().from(approvals).where(eq(approvals.id, approval.id)),
      );
      expect(reloaded.decidedBy).toBeNull();
    });
  });

  it("deleting a thread sets tasks.thread_id to null and removes its messages", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const workspace = await insertWorkspace(tx, "thread-set-null-workspace");
      const bot = await insertBot(tx, workspace.id, "thread-set-null-bot");
      const thread = await insertThread(tx, bot.id, "thread-set-null-thread");
      const task = await insertTask(tx, bot.id, thread.id, "thread-set-null-task");
      const message = await insertMessage(tx, thread.id);

      await tx.delete(threads).where(eq(threads.id, thread.id));

      const reloadedTask = first(await tx.select().from(tasks).where(eq(tasks.id, task.id)));
      expect(reloadedTask.threadId).toBeNull();

      const reloadedMessages = await tx.select().from(messages).where(eq(messages.id, message.id));
      expect(reloadedMessages).toEqual([]);
    });
  });
});

// --- bytea -----------------------------------------------------------------

describe("bytea columns", () => {
  it("round-trips a Buffer through a secret", async () => {
    const database = getDb();
    await withRollback(database, async (tx) => {
      const workspace = await insertWorkspace(tx, "bytea-workspace");
      const ciphertext = randomBytes(32);
      const encryptedDataKey = randomBytes(32);
      const nonce = randomBytes(12);

      const inserted = first(
        await tx
          .insert(secrets)
          .values({
            workspaceId: workspace.id,
            botId: null,
            name: "bytea-secret",
            ciphertext,
            encryptedDataKey,
            keyId: "key-1",
            nonce,
          })
          .returning(),
      );

      const reloaded = first(await tx.select().from(secrets).where(eq(secrets.id, inserted.id)));

      expect(Buffer.isBuffer(reloaded.ciphertext)).toBe(true);
      expect(reloaded.ciphertext.equals(ciphertext)).toBe(true);
      expect(reloaded.encryptedDataKey.equals(encryptedDataKey)).toBe(true);
      expect(reloaded.nonce.equals(nonce)).toBe(true);
    });
  });
});
