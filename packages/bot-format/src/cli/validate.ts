import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatIssue, type BotFormatIssue } from "../issues.js";
import { loadBot, loadCatalog } from "../load.js";

const USAGE = "usage: validate <bot-dir> [--catalog <mcp.json>]";

/** `catalog/mcp.json` at the repository root, resolved from `dist/cli/`. */
const DEFAULT_CATALOG = fileURLToPath(new URL("../../../../catalog/mcp.json", import.meta.url));

/** pnpm runs scripts in the package directory; the caller's directory is INIT_CWD. */
const INVOCATION_DIR = process.env.INIT_CWD ?? process.cwd();

interface Arguments {
  readonly dir: string;
  readonly catalog: string;
}

function parseArguments(argv: readonly string[]): Arguments | undefined {
  let dir: string | undefined;
  let catalog = DEFAULT_CATALOG;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--catalog") {
      const value = argv[index + 1];
      if (value === undefined) return undefined;
      catalog = path.resolve(INVOCATION_DIR, value);
      index += 1;
    } else if (argument !== undefined && !argument.startsWith("-") && dir === undefined) {
      dir = path.resolve(INVOCATION_DIR, argument);
    } else {
      return undefined;
    }
  }
  return dir === undefined ? undefined : { dir, catalog };
}

function printIssues(base: string, issues: readonly BotFormatIssue[]): void {
  for (const issue of issues) {
    const located =
      issue.file === undefined ? issue : { ...issue, file: path.join(base, issue.file) };
    console.error(formatIssue(located));
  }
}

function summary(slug: string, model: string, parts: readonly string[]): string {
  return `ok ${slug}: model ${model}, ${parts.join(", ")}`;
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));
  if (args === undefined) {
    console.error(USAGE);
    return 2;
  }

  const catalog = await loadCatalog(args.catalog);
  if (!catalog.ok) {
    printIssues("", catalog.issues);
    return 1;
  }

  const bot = await loadBot(args.dir, { catalog: catalog.value });
  const relative = path.relative(INVOCATION_DIR, args.dir);
  const shown = relative.startsWith("..") ? args.dir : relative || ".";
  if (!bot.ok) {
    printIssues(shown, bot.issues);
    return 1;
  }

  const { manifest, skills, mcp } = bot.value;
  const list = (items: readonly string[]): string =>
    items.length === 0 ? "0" : `${items.length} (${items.join(", ")})`;
  console.log(
    summary(bot.value.slug, manifest.model, [
      `auth ${manifest.auth ?? "unset"}`,
      `browser ${manifest.browser}`,
      `skills ${list(skills.map((skill) => skill.name))}`,
      `routines ${list(manifest.routines.map((routine) => routine.name))}`,
      `mcp ${list(Object.keys(mcp))}`,
      `memory ${bot.value.memory.exists ? "present" : "absent"}`,
    ]),
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
