import { readFile } from "node:fs/promises";

import { z } from "zod";

const manifestSchema = z.object({ version: z.string().min(1) });

/** The repository's root package.json is the single source of the version. */
export const ROOT_MANIFEST_URL = new URL("../../../package.json", import.meta.url);

export async function readRootVersion(manifestUrl: URL = ROOT_MANIFEST_URL): Promise<string> {
  const raw = await readFile(manifestUrl, "utf8");
  return manifestSchema.parse(JSON.parse(raw)).version;
}
