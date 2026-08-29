import { mcpCatalogSchema, type McpCatalog } from "@drobek-bot/contracts";

import { fail, ok, pathLabel, type BotFormatResult } from "./issues.js";

/** Parses the text of `catalog/mcp.json`. */
export function parseCatalog(text: string): BotFormatResult<McpCatalog> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail([{ line: 1, message: `invalid JSON: ${detail}` }]);
  }
  const parsed = mcpCatalogSchema.safeParse(data);
  if (parsed.success) return ok(parsed.data);
  return fail(
    parsed.error.issues.map((issue) => {
      const path = issue.path.map((segment) =>
        typeof segment === "symbol" ? String(segment) : segment,
      );
      const label = pathLabel(path);
      return {
        message: label.length === 0 ? issue.message : `${label}: ${issue.message}`,
        path,
      };
    }),
  );
}
