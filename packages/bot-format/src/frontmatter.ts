import { fail, ok, type BotFormatResult } from "./issues.js";

export interface Frontmatter {
  /** The YAML between the fences. */
  readonly yaml: string;
  /** Everything after the closing fence. */
  readonly body: string;
  /** 1-based file line of the first YAML line. */
  readonly yamlStartLine: number;
}

/** Splits `---` frontmatter from a Markdown body; the opening fence must be line 1. */
export function splitFrontmatter(text: string): BotFormatResult<Frontmatter> {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    return fail([{ line: 1, message: "expected YAML frontmatter: the first line must be ---" }]);
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return fail([{ line: 1, message: "unterminated frontmatter: no closing --- line" }]);
  }
  return ok({
    yaml: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n"),
    yamlStartLine: 2,
  });
}
