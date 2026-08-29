import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MIGRATIONS_FOLDER } from "./migrate.js";

/**
 * Migrations are additive-only: nothing here may ever drop a table, drop a
 * column, or rename anything. This test reads the SQL fresh off disk on
 * every run, so it fails the moment such a statement is added, however it
 * gets there (hand-written or drizzle-kit generated).
 */

const JOURNAL_PATH = fileURLToPath(new URL("../drizzle/meta/_journal.json", import.meta.url));

const journalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      tag: z.string().min(1),
    }),
  ),
});

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_FOLDER)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Drops full-line SQL comments (including the `--> statement-breakpoint` markers drizzle-kit emits) before scanning for forbidden statements. */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

const FORBIDDEN_STATEMENTS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "DROP TABLE", pattern: /\bdrop\s+table\b/i },
  { label: "DROP COLUMN", pattern: /\bdrop\s+column\b/i },
  { label: "RENAME", pattern: /\brename\b/i },
];

describe("migrations are additive-only", () => {
  const files = migrationFiles();

  it("finds at least one migration file to police", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} contains no destructive statement`, () => {
      const raw = readFileSync(path.join(MIGRATIONS_FOLDER, file), "utf8");
      const body = withoutComments(raw);
      for (const { label, pattern } of FORBIDDEN_STATEMENTS) {
        expect(body, `${file} must not contain ${label}`).not.toMatch(pattern);
      }
    });
  }

  it("would catch a destructive statement if one were added", () => {
    const poisoned = withoutComments('-- a drop table comment is ignored\nDROP TABLE "runs";');
    expect(poisoned).toMatch(/\bdrop\s+table\b/i);
    const commentOnly = withoutComments('-- DROP TABLE "runs";\nSELECT 1;');
    expect(commentOnly).not.toMatch(/\bdrop\s+table\b/i);
  });

  it("lists every SQL file in the journal, in order, and nothing else", () => {
    const raw = readFileSync(JOURNAL_PATH, "utf8");
    const journal = journalSchema.parse(JSON.parse(raw));

    const journalIndexes = journal.entries.map((entry) => entry.idx);
    expect(journalIndexes).toEqual(journal.entries.map((_entry, position) => position));

    const journalFiles = journal.entries.map((entry) => `${entry.tag}.sql`);
    expect(journalFiles).toEqual(files);
  });
});
