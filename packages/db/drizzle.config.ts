import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` diffs `src/schema` against the last snapshot and
 * writes the SQL into `drizzle/`. Migrations are applied by `migrate()` from
 * this package, never by drizzle-kit, so no database credentials live here.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
});
