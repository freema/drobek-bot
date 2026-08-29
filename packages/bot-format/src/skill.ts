import { skillFrontmatterSchema, type SkillFrontmatter } from "@drobek-bot/contracts";

import { splitFrontmatter } from "./frontmatter.js";
import { fail, ok, type BotFormatResult } from "./issues.js";
import { issuesFromZod, parseYaml } from "./yaml.js";

export interface ParsedSkill {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
}

/**
 * Parses a `SKILL.md`: `name` and `description` are required, the other
 * documented fields are typed, anything else passes through. Whether `name`
 * equals the folder name is the loader's check, which knows the folder.
 */
export function parseSkill(text: string): BotFormatResult<ParsedSkill> {
  const split = splitFrontmatter(text);
  if (!split.ok) return split;
  const { source, errors } = parseYaml(split.value.yaml, split.value.yamlStartLine - 1);
  if (errors.length > 0) return fail(errors);
  const parsed = skillFrontmatterSchema.safeParse(source.data);
  if (!parsed.success) return fail(issuesFromZod(parsed.error, source));
  return ok({ frontmatter: parsed.data, body: split.value.body.trim() });
}
