import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** The column conventions every table follows; builders are fresh per call. */

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const timestampTz = (name: string) => timestamp(name, { withTimezone: true });

/** Raw bytes; `pg` maps `bytea` to `Buffer` in both directions. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
