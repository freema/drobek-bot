import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, migrate, type Db } from "./index.js";

describe("migrate", () => {
  let container: StartedPostgreSqlContainer | undefined;
  let pool: pg.Pool | undefined;
  let db: Db | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it("creates the runs table", async () => {
    if (!db) throw new Error("database not started");
    await migrate(db);
    const result = await db.execute(sql`select to_regclass('public.runs')::text as name`);
    expect(result.rows[0]?.name).toBe("runs");
  });
});
