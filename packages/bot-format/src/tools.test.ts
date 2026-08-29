import { describe, expect, it } from "vitest";

import { missingTools } from "./tools.js";

describe("missingTools", () => {
  it("is a pure set difference, preserving declaration order", () => {
    expect(missingTools(["gh", "glab", "curl"], ["glab"])).toEqual(["gh", "curl"]);
  });

  it("is empty when every required tool is available", () => {
    expect(missingTools(["gh", "glab"], ["gh", "glab", "curl"])).toEqual([]);
  });

  it("is empty when nothing is required", () => {
    expect(missingTools([], ["gh"])).toEqual([]);
  });

  it("lists every tool as missing when none are available", () => {
    expect(missingTools(["gh", "glab"], [])).toEqual(["gh", "glab"]);
  });

  it("collapses duplicate requirements without disturbing order", () => {
    expect(missingTools(["gh", "gh", "glab"], [])).toEqual(["gh", "glab"]);
  });

  it("does not mutate its inputs", () => {
    const requires = ["gh", "glab"];
    const available = ["gh"];
    missingTools(requires, available);
    expect(requires).toEqual(["gh", "glab"]);
    expect(available).toEqual(["gh"]);
  });
});
