import type {
  BotManifest,
  McpCatalog,
  McpCatalogEntry,
  ResolvedMcp,
  ResolvedMcpServer,
} from "@drobek-bot/contracts";

import { fail, ok, type BotFormatIssue, type BotFormatResult } from "./issues.js";

/** The server an `mcp` entry gets when it points at a catalog entry. */
export function catalogEntryToServer(entry: McpCatalogEntry): ResolvedMcpServer {
  if (entry.transport === "stdio") {
    return { command: entry.command, args: entry.args };
  }
  return { url: entry.url, type: entry.transport };
}

/** Expands every `{ catalog: id }` entry; an unknown id is an error. */
export function resolveMcp(
  manifest: Pick<BotManifest, "mcp">,
  catalog: McpCatalog,
): BotFormatResult<ResolvedMcp> {
  const resolved: ResolvedMcp = {};
  const issues: BotFormatIssue[] = [];
  for (const [name, entry] of Object.entries(manifest.mcp)) {
    if (!("catalog" in entry)) {
      resolved[name] = entry;
      continue;
    }
    const found = catalog.find((candidate) => candidate.id === entry.catalog);
    if (found === undefined) {
      issues.push({
        message: `mcp.${name}: unknown catalog id "${entry.catalog}"`,
        path: ["mcp", name, "catalog"],
      });
      continue;
    }
    resolved[name] = catalogEntryToServer(found);
  }
  return issues.length > 0 ? fail(issues) : ok(resolved);
}
