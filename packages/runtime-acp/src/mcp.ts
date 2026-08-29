/**
 * The app's MCP server shape (the one `.mcp.json` uses, from
 * `@drobek-bot/contracts`) as ACP's, for `session/new` and `session/load`.
 *
 * These are the servers the app adds for a run. A bot's own servers are in the
 * `.mcp.json` written into its project, which Claude Code reads by itself.
 */
import type { EnvVariable, HttpHeader, McpServer } from "@agentclientprotocol/sdk";
import type { ClaudeMcpServer } from "@drobek-bot/contracts";

function envVariables(env: Readonly<Record<string, string>> | undefined): EnvVariable[] {
  return Object.entries(env ?? {}).map(([name, value]) => ({ name, value }));
}

function httpHeaders(headers: Readonly<Record<string, string>> | undefined): HttpHeader[] {
  return Object.entries(headers ?? {}).map(([name, value]) => ({ name, value }));
}

export function toAcpMcpServers(
  servers: Readonly<Record<string, ClaudeMcpServer>> | undefined,
): McpServer[] {
  return Object.entries(servers ?? {}).map(([name, server]) =>
    "url" in server
      ? { type: server.type, name, url: server.url, headers: httpHeaders(server.headers) }
      : {
          name,
          command: server.command,
          args: [...(server.args ?? [])],
          env: envVariables(server.env),
        },
  );
}
