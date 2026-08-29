import { botManifestSchema, type BotManifest } from "@drobek-bot/contracts";

import { fail, ok, type BotFormatResult } from "./issues.js";
import { issuesFromZod, parseYaml } from "./yaml.js";

/** Parses `bot.yaml`; unknown keys are errors, defaults are filled in. */
export function parseManifest(text: string): BotFormatResult<BotManifest> {
  const { source, errors } = parseYaml(text);
  if (errors.length > 0) return fail(errors);
  const parsed = botManifestSchema.safeParse(source.data);
  return parsed.success ? ok(parsed.data) : fail(issuesFromZod(parsed.error, source));
}
