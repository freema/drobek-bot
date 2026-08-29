import pg from "pg";
import { z } from "zod";

import { createDb } from "../db.js";
import { migrate } from "../migrate.js";

const envSchema = z.object({ DATABASE_URL: z.string().min(1) });

/** `pnpm db:migrate`: applies pending migrations to `DATABASE_URL` and exits 0, or 1 on failure. */
async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await migrate(createDb(pool));
    console.log("database migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("database migration failed:", error);
  process.exit(1);
});
