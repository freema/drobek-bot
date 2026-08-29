import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root, resolved from this package's location. */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
