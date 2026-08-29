import { LineCounter, isMap, isNode, isScalar, parseDocument, type Node } from "yaml";
import type { ZodError } from "zod";

import { pathLabel, type BotFormatIssue, type DataPath } from "./issues.js";

/** A parsed YAML document that can still say on which line a value sits. */
export interface YamlSource {
  readonly data: unknown;
  /** The first line of the document in the file (after any frontmatter fence). */
  readonly firstLine: number;
  /** Line of the value at `path`, or of its closest ancestor. */
  lineOf(path: DataPath): number | undefined;
  /** Line of the key `key` in the map at `path`. */
  lineOfKey(path: DataPath, key: string): number | undefined;
}

export interface ParsedYaml {
  readonly source: YamlSource;
  /** Syntax errors; when present, `source.data` is not to be trusted. */
  readonly errors: readonly BotFormatIssue[];
}

/**
 * Parses YAML and keeps the line map. `lineOffset` is the number of file
 * lines before the YAML text (1 for a `---` fence on the first line).
 */
export function parseYaml(text: string, lineOffset = 0): ParsedYaml {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter });
  const lineAt = (offset: number): number => lineCounter.linePos(offset).line + lineOffset;
  const lineOfNode = (node: Node): number | undefined =>
    node.range ? lineAt(node.range[0]) : undefined;
  const nodeAt = (path: DataPath): Node | undefined => {
    const found: unknown = path.length === 0 ? doc.contents : doc.getIn(path, true);
    return isNode(found) ? found : undefined;
  };
  const data: unknown = doc.toJS();

  const source: YamlSource = {
    data,
    firstLine: lineOffset + 1,
    lineOf(path) {
      for (let depth = path.length; depth >= 0; depth -= 1) {
        const node = nodeAt(path.slice(0, depth));
        const line = node === undefined ? undefined : lineOfNode(node);
        if (line !== undefined) return line;
      }
      return undefined;
    },
    lineOfKey(path, key) {
      const map = nodeAt(path);
      if (!isMap(map)) return undefined;
      const pair = map.items.find((item) => isScalar(item.key) && item.key.value === key);
      return isNode(pair?.key) ? lineOfNode(pair.key) : undefined;
    },
  };

  const errors = doc.errors.map((error) => ({
    message: `invalid YAML: ${error.message.split("\n")[0] ?? error.code}`,
    line: lineAt(error.pos[0]),
  }));
  return { source, errors };
}

function toDataPath(path: readonly PropertyKey[]): DataPath {
  return path.map((segment) => (typeof segment === "symbol" ? String(segment) : segment));
}

/** Maps zod issues onto lines of the document they were found in. */
export function issuesFromZod(error: ZodError, source: YamlSource): BotFormatIssue[] {
  const issues: BotFormatIssue[] = [];
  for (const issue of error.issues) {
    const path = toDataPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const keyPath = [...path, key];
        issues.push({
          message: `${pathLabel(keyPath)}: unknown key`,
          line: source.lineOfKey(path, key) ?? source.lineOf(path) ?? source.firstLine,
          path: keyPath,
        });
      }
      continue;
    }
    const label = pathLabel(path);
    issues.push({
      message: label.length === 0 ? issue.message : `${label}: ${issue.message}`,
      line: source.lineOf(path) ?? source.firstLine,
      path,
    });
  }
  return issues;
}
