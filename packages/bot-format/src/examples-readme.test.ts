/**
 * Pins `README.md`'s "## Example bots" section against the actual gallery
 * in `bots/examples/`: the five slugs in the documented order, each with
 * both "Add to drobek bot" commands; every slug the section names exists as
 * a directory and vice versa; and the section is honest that the runtime a
 * copied bot needs is not shipped yet.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const EXAMPLES = fileURLToPath(new URL("../../../bots/examples", import.meta.url));
const README = fileURLToPath(new URL("../../../README.md", import.meta.url));

const exampleDirs = readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const EXPECTED_SLUG_ORDER = [
  "inbox-briefing",
  "github-briefing",
  "pr-triage",
  "sentry-watch",
  "standup-notes",
];

const SECTION_HEADING = "\n## Example bots\n";

/** The body of the "## Example bots" section, up to (not including) the next `## ` heading. */
function exampleBotsSection(): string {
  const text = readFileSync(README, "utf8");
  const headingIndex = text.indexOf(SECTION_HEADING);
  if (headingIndex === -1) {
    throw new Error('README.md has no "## Example bots" section');
  }
  const sectionStart = headingIndex + SECTION_HEADING.length;
  const nextHeadingIndex = text.indexOf("\n## ", sectionStart);
  return text.slice(sectionStart, nextHeadingIndex === -1 ? text.length : nextHeadingIndex);
}

/** `cp -r bots/examples/<from> bots/<to>` occurrences, in document order. */
function copyCommands(section: string): Array<{ from: string; to: string; line: string }> {
  const pattern = /cp -r bots\/examples\/([a-z0-9-]+) bots\/([a-z0-9-]+)/g;
  return [...section.matchAll(pattern)].map((match) => {
    const from = match[1];
    const to = match[2];
    if (from === undefined || to === undefined) {
      throw new Error(`matched a cp command with a missing slug: "${match[0]}"`);
    }
    return { from, to, line: match[0] };
  });
}

describe("README.md: the example bots gallery", () => {
  it("the gallery on disk holds exactly the five documented slugs", () => {
    expect(exampleDirs).toEqual([...EXPECTED_SLUG_ORDER].sort());
  });

  it('names exactly the five slugs, in order, each with a "cp -r" command', () => {
    const commands = copyCommands(exampleBotsSection());
    expect(commands.map((command) => command.from)).toEqual(EXPECTED_SLUG_ORDER);
  });

  it('every "cp -r" command copies a slug onto the same slug under bots/', () => {
    const commands = copyCommands(exampleBotsSection());
    for (const command of commands) {
      expect(command.to, command.line).toBe(command.from);
    }
  });

  it("every documented slug is followed by the matching validate command", () => {
    const section = exampleBotsSection();
    for (const command of copyCommands(section)) {
      expect(section, command.from).toContain(
        `pnpm --filter @drobek-bot/bot-format validate bots/${command.from}`,
      );
    }
  });

  it("every slug the section names exists as a directory, and vice versa", () => {
    const namedSlugs = new Set(copyCommands(exampleBotsSection()).map((command) => command.from));
    expect(namedSlugs).toEqual(new Set(exampleDirs));
  });

  it('says the runtime a copied bot needs is not shipped yet ("planned" or "coming")', () => {
    expect(/\bplanned\b|\bcoming\b/i.test(exampleBotsSection())).toBe(true);
  });
});
