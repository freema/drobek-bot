import { migrate as applyMigrations } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";

import type { Db } from "./db.js";

/**
 * `packages/db/drizzle`, one directory above this file whether it runs from
 * `src/` (development) or `dist/` (the image, which ships the SQL alongside).
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies every migration not yet recorded in `drizzle.__drizzle_migrations`; a second run is a no-op. */
export async function migrate(db: Db): Promise<void> {
  await applyMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
