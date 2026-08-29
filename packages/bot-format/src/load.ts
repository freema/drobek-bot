/**
 * The only I/O in this package: reading a bot folder and the catalog file.
 * Everything read is validated by the pure parsers and scanned for secrets.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { slugSchema, type McpCatalog } from "@drobek-bot/contracts";

import { parseBotMd } from "./bot-md.js";
import { parseCatalog } from "./catalog.js";
import { splitFrontmatter } from "./frontmatter.js";
import { fail, ok, type BotFormatIssue, type BotFormatResult } from "./issues.js";
import { parseManifest } from "./manifest.js";
import { resolveMcp } from "./mcp.js";
import { findSecretLikeStrings } from "./secrets.js";
import { parseSkill } from "./skill.js";
import type { LoadedBot, LoadedSkill } from "./types.js";
import { parseYaml } from "./yaml.js";

export const BOT_MD = "BOT.md";
export const BOT_YAML = "bot.yaml";
export const SKILLS_DIR = "skills";
export const SKILL_MD = "SKILL.md";
export const MEMORY_DIR = "memory";

export interface LoadBotOptions {
  readonly catalog: McpCatalog;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The file's text, or `undefined` when it does not exist. */
async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

function withFile(file: string, issues: readonly BotFormatIssue[]): BotFormatIssue[] {
  return issues.map((issue) => ({ ...issue, file }));
}

function secretIssues(file: string, text: string): BotFormatIssue[] {
  return findSecretLikeStrings(text).map((match) => ({
    file,
    line: match.line,
    message: `secret-shaped string (${match.kind}, ${match.preview}): credentials never go into bot files`,
  }));
}

/** Line of the `name` key in a skill's frontmatter, for the folder-name check. */
function skillNameLine(text: string): number | undefined {
  const split = splitFrontmatter(text);
  if (!split.ok) return undefined;
  return parseYaml(split.value.yaml, split.value.yamlStartLine - 1).source.lineOfKey([], "name");
}

/**
 * Reads `dir` as a bot folder: `BOT.md`, `bot.yaml`, every
 * `skills/<name>/SKILL.md` and whether `memory/` exists; scans every file it
 * read for secrets; resolves catalog references. Every issue found is
 * returned together.
 */
export async function loadBot(
  dir: string,
  options: LoadBotOptions,
): Promise<BotFormatResult<LoadedBot>> {
  const root = path.resolve(dir);
  const slug = path.basename(root);
  const issues: BotFormatIssue[] = [];

  if (!(await isDirectory(root))) {
    return fail([{ message: `${root} is not a directory` }]);
  }
  const slugCheck = slugSchema.safeParse(slug);
  if (!slugCheck.success) {
    issues.push({ message: `folder name "${slug}" is not a valid slug` });
  }

  const botMdText = await readText(path.join(root, BOT_MD));
  let botMd: ReturnType<typeof parseBotMd> | undefined;
  if (botMdText === undefined) {
    issues.push({ file: BOT_MD, message: "missing" });
  } else {
    issues.push(...secretIssues(BOT_MD, botMdText));
    botMd = parseBotMd(botMdText);
    if (!botMd.ok) issues.push(...withFile(BOT_MD, botMd.issues));
  }

  const manifestText = await readText(path.join(root, BOT_YAML));
  let manifest: ReturnType<typeof parseManifest> | undefined;
  if (manifestText === undefined) {
    issues.push({ file: BOT_YAML, message: "missing" });
  } else {
    issues.push(...secretIssues(BOT_YAML, manifestText));
    manifest = parseManifest(manifestText);
    if (!manifest.ok) issues.push(...withFile(BOT_YAML, manifest.issues));
  }

  const skills: LoadedSkill[] = [];
  for (const name of await subdirectories(path.join(root, SKILLS_DIR))) {
    const file = `${SKILLS_DIR}/${name}/${SKILL_MD}`;
    if (!slugSchema.safeParse(name).success) {
      issues.push({ file, message: `skill folder "${name}" is not a valid slug` });
    }
    const text = await readText(path.join(root, SKILLS_DIR, name, SKILL_MD));
    if (text === undefined) {
      issues.push({ file, message: "missing" });
      continue;
    }
    issues.push(...secretIssues(file, text));
    const skill = parseSkill(text);
    if (!skill.ok) {
      issues.push(...withFile(file, skill.issues));
      continue;
    }
    if (skill.value.frontmatter.name !== name) {
      issues.push({
        file,
        line: skillNameLine(text),
        message: `name "${skill.value.frontmatter.name}" must equal the folder name "${name}"`,
      });
      continue;
    }
    skills.push({ name, file, ...skill.value, text });
  }

  const memoryPath = path.join(root, MEMORY_DIR);
  const memory = { path: memoryPath, exists: await isDirectory(memoryPath) };

  if (issues.length > 0 || botMd?.ok !== true || manifest?.ok !== true) {
    return fail(issues);
  }

  const mcp = resolveMcp(manifest.value, options.catalog);
  if (!mcp.ok) {
    const { source } = parseYaml(manifestText ?? "");
    return fail(
      mcp.issues.map((issue) => ({
        ...issue,
        file: BOT_YAML,
        line: issue.path === undefined ? undefined : source.lineOf(issue.path),
      })),
    );
  }

  return ok({
    slug,
    dir: root,
    identity: botMd.value.identity,
    systemPrompt: botMd.value.body,
    manifest: manifest.value,
    mcp: mcp.value,
    skills,
    memory,
  });
}

/** Reads and validates a catalog file such as `catalog/mcp.json`. */
export async function loadCatalog(file: string): Promise<BotFormatResult<McpCatalog>> {
  const text = await readText(file);
  if (text === undefined) return fail([{ file, message: "missing" }]);
  const parsed = parseCatalog(text);
  return parsed.ok ? parsed : fail(withFile(file, parsed.issues));
}
