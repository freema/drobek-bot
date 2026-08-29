/**
 * Playwright MCP inside the box, attached to the host's Chrome over CDP, in
 * Claude Code's own `.mcp.json` shape. Chrome only accepts a Host header that
 * is an IP address or `localhost`, so the endpoint carries the address that
 * `host.docker.internal` resolves to inside the box rather than the name.
 */
export const CDP_PORT = 9222;

export function playwrightMcpConfig(hostIp: string): unknown {
  return {
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["-y", "@playwright/mcp@0.0.79", "--cdp-endpoint", `http://${hostIp}:${CDP_PORT}`],
      },
    },
  };
}
