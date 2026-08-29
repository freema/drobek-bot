/**
 * Tool-name patterns, the rule the box spike's policy uses: an exact tool
 * name (`Bash`, `mcp__github__get_issue`), a prefix followed by `*`
 * (`mcp__github__*`), or `*` alone for everything.
 */

export const TOOL_NAME_PATTERN = /^(?:\*|[A-Za-z0-9_-]+\*?)$/;

/** True when `pattern` is a well-formed tool-name pattern. */
export function isToolNamePattern(pattern: string): boolean {
  return TOOL_NAME_PATTERN.test(pattern);
}

/** True when `toolName` is covered by `pattern`. */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return toolName === pattern;
}
