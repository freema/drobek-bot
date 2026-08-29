/**
 * Errors are values. Every parser returns a `BotFormatResult`; a failure
 * carries every issue found, so a validator can print them all at once.
 */

export type DataPath = readonly (string | number)[];

/** One problem in a bot folder. `file` is relative to the folder; `line` is 1-based. */
export interface BotFormatIssue {
  readonly message: string;
  /** Unknown for the pure parsers, filled in by the loader. */
  readonly file?: string;
  readonly line?: number;
  /** Where in the parsed document the issue sits, e.g. `["routines", 0, "cron"]`. */
  readonly path?: DataPath;
}

export type BotFormatResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly BotFormatIssue[] };

export function ok<T>(value: T): BotFormatResult<T> {
  return { ok: true, value };
}

export function fail<T>(issues: readonly BotFormatIssue[]): BotFormatResult<T> {
  return { ok: false, issues };
}

/** `routines[0].cron`; the empty path is the document itself. */
export function pathLabel(path: DataPath): string {
  return path
    .map((segment, index) =>
      typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
    )
    .join("");
}

/** `file:line message`, with the parts that are known. */
export function formatIssue(issue: BotFormatIssue): string {
  const location =
    issue.file === undefined
      ? ""
      : issue.line === undefined
        ? `${issue.file} `
        : `${issue.file}:${issue.line} `;
  return `${location}${issue.message}`;
}
