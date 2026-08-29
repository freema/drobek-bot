import type { BotManifest, McpCatalog } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { catalogEntryToServer, resolveMcp } from "./mcp.js";

const CATALOG: McpCatalog = [
  {
    id: "github",
    name: "GitHub",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "oauth",
    docs: "https://example.com/docs/github",
  },
  {
    id: "playwright",
    name: "Playwright browser",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    auth: "none",
    docs: "https://example.com/docs/playwright",
  },
];

describe("catalogEntryToServer", () => {
  it("maps a stdio catalog entry onto { command, args }", () => {
    const entry = CATALOG[1];
    if (entry === undefined) throw new Error("fixture entry missing");
    expect(catalogEntryToServer(entry)).toEqual({
      command: "npx",
      args: ["-y", "@playwright/mcp"],
    });
  });

  it("maps a remote catalog entry onto { url, type }", () => {
    const entry = CATALOG[0];
    if (entry === undefined) throw new Error("fixture entry missing");
    expect(catalogEntryToServer(entry)).toEqual({
      url: "https://api.githubcopilot.com/mcp/",
      type: "http",
    });
  });
});

describe("resolveMcp", () => {
  it("leaves explicit remote and stdio entries unchanged", () => {
    const manifest: Pick<BotManifest, "mcp"> = {
      mcp: {
        remote: { url: "https://example.com/mcp", type: "sse" },
        local: { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "x" } },
      },
    };
    const result = resolveMcp(manifest, []);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual(manifest.mcp);
  });

  it("expands a { catalog } reference into the catalog entry's server shape", () => {
    const manifest: Pick<BotManifest, "mcp"> = { mcp: { github: { catalog: "github" } } };
    const result = resolveMcp(manifest, CATALOG);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual({
      github: { url: "https://api.githubcopilot.com/mcp/", type: "http" },
    });
  });

  it("reports an unknown catalog id", () => {
    const manifest: Pick<BotManifest, "mcp"> = { mcp: { oops: { catalog: "not-in-catalog" } } };
    const result = resolveMcp(manifest, CATALOG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: 'mcp.oops: unknown catalog id "not-in-catalog"',
        path: ["mcp", "oops", "catalog"],
      },
    ]);
  });

  it("collects every unknown catalog id, not just the first", () => {
    const manifest: Pick<BotManifest, "mcp"> = {
      mcp: {
        a: { catalog: "missing-one" },
        b: { catalog: "github" },
        c: { catalog: "missing-two" },
      },
    };
    const result = resolveMcp(manifest, CATALOG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(2);
    expect(result.issues.map((issue) => issue.path)).toEqual([
      ["mcp", "a", "catalog"],
      ["mcp", "c", "catalog"],
    ]);
  });

  it("resolves a mix of explicit and catalog-reference entries", () => {
    const manifest: Pick<BotManifest, "mcp"> = {
      mcp: {
        github: { catalog: "github" },
        custom: { url: "https://custom.example.com/mcp" },
      },
    };
    const result = resolveMcp(manifest, CATALOG);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual({
      github: { url: "https://api.githubcopilot.com/mcp/", type: "http" },
      custom: { url: "https://custom.example.com/mcp" },
    });
  });

  it("resolves an empty mcp map to an empty result", () => {
    const result = resolveMcp({ mcp: {} }, CATALOG);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual({});
  });
});
