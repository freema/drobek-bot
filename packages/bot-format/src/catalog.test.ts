import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { mcpCatalogSchema, slugSchema } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

import { parseCatalog } from "./catalog.js";

const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

async function readCatalog(): Promise<unknown> {
  const data: unknown = JSON.parse(await readFile(CATALOG, "utf8"));
  return data;
}

describe("catalog/mcp.json", () => {
  it("validates against mcpCatalogSchema", async () => {
    const data = await readCatalog();
    const parsed = mcpCatalogSchema.safeParse(data);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.length).toBeGreaterThan(0);
  });

  it("has unique slug ids", async () => {
    const parsed = mcpCatalogSchema.safeParse(await readCatalog());
    if (!parsed.success) throw new Error(parsed.error.message);
    const ids = parsed.data.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(slugSchema.safeParse(id).success).toBe(true);
    }
  });

  it("gives every entry an https docs URL", async () => {
    const parsed = mcpCatalogSchema.safeParse(await readCatalog());
    if (!parsed.success) throw new Error(parsed.error.message);
    for (const entry of parsed.data) {
      expect(new URL(entry.docs).protocol).toBe("https:");
    }
  });

  it("gives http/sse entries a url and stdio entries a command", async () => {
    const parsed = mcpCatalogSchema.safeParse(await readCatalog());
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.length).toBeGreaterThan(0);
    for (const entry of parsed.data) {
      if (entry.transport === "stdio") {
        expect(entry.command.length).toBeGreaterThan(0);
        expect("url" in entry).toBe(false);
      } else {
        expect(entry.url.length).toBeGreaterThan(0);
        expect("command" in entry).toBe(false);
      }
    }
    // The reference catalog carries at least one of each transport family.
    expect(parsed.data.some((entry) => entry.transport === "stdio")).toBe(true);
    expect(parsed.data.some((entry) => entry.transport !== "stdio")).toBe(true);
  });
});

describe("parseCatalog", () => {
  it("reports invalid JSON on line 1", () => {
    const result = parseCatalog("{not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.line).toBe(1);
    expect(result.issues[0]?.message).toContain("invalid JSON");
  });

  it("reports a duplicate id", () => {
    const entry = (id: string, url: string) => ({
      id,
      name: "X",
      transport: "http",
      url,
      auth: "none",
      docs: "https://example.com",
    });
    const result = parseCatalog(
      JSON.stringify([
        entry("dup", "https://a.example.com"),
        entry("dup", "https://b.example.com"),
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((issue) => issue.message.includes('duplicate catalog id "dup"')),
    ).toBe(true);
  });

  it("rejects an unknown transport", () => {
    const result = parseCatalog(
      JSON.stringify([
        {
          id: "x",
          name: "X",
          transport: "websocket",
          url: "https://example.com",
          auth: "none",
          docs: "https://example.com",
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("requires url on an http/sse entry", () => {
    const result = parseCatalog(
      JSON.stringify([
        { id: "x", name: "X", transport: "http", auth: "none", docs: "https://example.com" },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("requires command on a stdio entry", () => {
    const result = parseCatalog(
      JSON.stringify([
        {
          id: "x",
          name: "X",
          transport: "stdio",
          args: [],
          auth: "none",
          docs: "https://example.com",
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a docs value that is not a URL at all", () => {
    const result = parseCatalog(
      JSON.stringify([
        {
          id: "x",
          name: "X",
          transport: "http",
          url: "https://example.com",
          auth: "none",
          docs: "not-a-url",
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed catalog with both transport families", () => {
    const result = parseCatalog(
      JSON.stringify([
        {
          id: "remote-one",
          name: "Remote",
          transport: "http",
          url: "https://example.com/mcp",
          auth: "oauth",
          docs: "https://example.com/docs",
        },
        {
          id: "local-one",
          name: "Local",
          transport: "stdio",
          command: "npx",
          args: ["-y", "pkg"],
          auth: "none",
          docs: "https://example.com/docs",
        },
      ]),
    );
    expect(result.ok).toBe(true);
  });
});
