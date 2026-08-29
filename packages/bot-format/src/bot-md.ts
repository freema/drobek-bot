import { botIdentitySchema, type BotIdentity } from "@drobek-bot/contracts";

import { splitFrontmatter } from "./frontmatter.js";
import { fail, ok, type BotFormatIssue, type BotFormatResult } from "./issues.js";
import { issuesFromZod, parseYaml } from "./yaml.js";

export interface ParsedBotMd {
  readonly identity: BotIdentity;
  /** The Markdown body, trimmed: this becomes the system prompt. */
  readonly body: string;
}

/** Parses `BOT.md`: exactly `name`, `job`, `language` in the frontmatter, then a body. */
export function parseBotMd(text: string): BotFormatResult<ParsedBotMd> {
  const split = splitFrontmatter(text);
  if (!split.ok) return split;
  const { source, errors } = parseYaml(split.value.yaml, split.value.yamlStartLine - 1);
  if (errors.length > 0) return fail(errors);

  const parsed = botIdentitySchema.safeParse(source.data);
  const issues: BotFormatIssue[] = parsed.success ? [] : issuesFromZod(parsed.error, source);
  const body = split.value.body.trim();
  if (body.length === 0) {
    issues.push({
      line: split.value.yamlStartLine,
      message: "BOT.md has no body: the Markdown after the frontmatter is the system prompt",
    });
  }
  if (!parsed.success || issues.length > 0) return fail(issues);
  return ok({ identity: parsed.data, body });
}
