/**
 * Pinning the model for a run.
 *
 * Neither `_meta.claudeCode.options.model` on `session/new` nor `ANTHROPIC_MODEL`
 * in the box has any effect: the ACP adapter calls `setModel(models[0])` after
 * start and the run goes to the default model. What works is Claude Code's own
 * `"model"` in the project's `.claude/settings.json`, written into the box
 * before the agent is started. Both dead ends are measured and recorded in
 * `docs/progress.md` under "Failed approaches" — do not try them again.
 *
 * The file belongs to the bot, not to this package: whatever else is in it is
 * read back and kept, so pinning a model never quietly drops a setting someone
 * put there.
 */
import { ComputerError, RuntimeError, type Computer } from "@drobek-bot/core";
import { z } from "zod";

/** Relative to the session's working directory in the box. */
export const SETTINGS_FILE = ".claude/settings.json";

const settingsSchema = z.record(z.string(), z.unknown());

const modelSchema = z.string().min(1);

/** `settings` with `model` set, as the file's new content. `settings` is the file's current text. */
export function withModel(settings: string | undefined, model: string): string {
  const current = parseSettings(settings);
  return `${JSON.stringify({ ...current, model }, null, 2)}\n`;
}

function parseSettings(settings: string | undefined): Record<string, unknown> {
  if (settings === undefined || settings.trim() === "") return {};
  let json: unknown;
  try {
    json = JSON.parse(settings);
  } catch {
    throw new RuntimeError("invalid-input", `${SETTINGS_FILE} in the box is not JSON`);
  }
  const parsed = settingsSchema.safeParse(json);
  if (!parsed.success) {
    throw new RuntimeError("invalid-input", `${SETTINGS_FILE} in the box is not an object`);
  }
  return parsed.data;
}

/** Writes the model pin into the box's project settings, creating the file if needed. */
export async function pinModel(computer: Computer, cwd: string, model: string): Promise<void> {
  if (!modelSchema.safeParse(model).success) {
    throw new RuntimeError("invalid-input", "model must not be empty");
  }
  const path = `${cwd}/${SETTINGS_FILE}`;
  let existing: string | undefined;
  try {
    existing = new TextDecoder().decode(await computer.readFile(path));
  } catch (error) {
    if (!(error instanceof ComputerError) || error.kind !== "file-not-found") throw error;
    const parent = path.slice(0, path.lastIndexOf("/"));
    const made = await computer.runCommand(["mkdir", "-p", parent]);
    if (made.exitCode !== 0) {
      throw new RuntimeError("unavailable", `cannot create ${parent} in the box`);
    }
  }
  await computer.writeFile(path, new TextEncoder().encode(withModel(existing, model)));
}
