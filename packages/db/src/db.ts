import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type pg from "pg";

import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;

/** Drizzle over a caller-owned `pg` pool; the caller opens and closes the pool. */
export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool, schema });
}
