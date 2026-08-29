import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./repo.js";

describe("policy tests package", () => {
  it("resolves the repository root", () => {
    expect(existsSync(path.join(REPO_ROOT, "README.md"))).toBe(true);
    expect(existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"))).toBe(true);
  });
});
