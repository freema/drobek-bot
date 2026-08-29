import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { mcpCatalogSchema } from "@drobek-bot/contracts";
import { describe, expect, it } from "vitest";

const CATALOG = fileURLToPath(new URL("../../../catalog/mcp.json", import.meta.url));

describe("catalog/mcp.json", () => {
  it("validates against mcpCatalogSchema", async () => {
    const data: unknown = JSON.parse(await readFile(CATALOG, "utf8"));
    const parsed = mcpCatalogSchema.safeParse(data);
    expect(parsed.success, parsed.error?.message).toBe(true);
    expect(parsed.data?.length).toBeGreaterThan(0);
  });
});
