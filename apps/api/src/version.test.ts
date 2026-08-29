import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { readRootVersion } from "./version.js";

const rootManifestSchema = z.object({ version: z.string() });

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

async function manifestUrl(content: string): Promise<URL> {
  dir = await mkdtemp(join(tmpdir(), "drobek-bot-version-test-"));
  const path = join(dir, "package.json");
  await writeFile(path, content, "utf8");
  return pathToFileURL(path);
}

describe("readRootVersion", () => {
  it("reads the version out of the repository's root package.json by default", async () => {
    const raw = await readFile(new URL("../../../package.json", import.meta.url), "utf8");
    const expected = rootManifestSchema.parse(JSON.parse(raw));

    const version = await readRootVersion();
    expect(version).toBe(expected.version);
  });

  it("reads the version out of a given manifest url", async () => {
    const url = await manifestUrl(JSON.stringify({ version: "9.9.9" }));
    await expect(readRootVersion(url)).resolves.toBe("9.9.9");
  });

  it("rejects when the manifest has no version field", async () => {
    const url = await manifestUrl(JSON.stringify({ name: "no-version-here" }));
    await expect(readRootVersion(url)).rejects.toThrow();
  });

  it("rejects when the manifest's version is empty", async () => {
    const url = await manifestUrl(JSON.stringify({ version: "" }));
    await expect(readRootVersion(url)).rejects.toThrow();
  });

  it("rejects when the manifest is not valid JSON", async () => {
    const url = await manifestUrl("not json");
    await expect(readRootVersion(url)).rejects.toThrow();
  });
});
