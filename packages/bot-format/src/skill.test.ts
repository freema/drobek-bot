import { describe, expect, it } from "vitest";

import { parseSkill } from "./skill.js";

function skillMd(lines: readonly string[]): string {
  return lines.join("\n");
}

describe("parseSkill", () => {
  it("requires a description between 1 and 1024 characters", () => {
    expect(parseSkill(skillMd(["---", "name: a", "description: ''", "---", "Body."])).ok).toBe(
      false,
    );
    expect(
      parseSkill(skillMd(["---", "name: a", `description: "${"x".repeat(1024)}"`, "---", "Body."]))
        .ok,
    ).toBe(true);
    expect(
      parseSkill(skillMd(["---", "name: a", `description: "${"x".repeat(1025)}"`, "---", "Body."]))
        .ok,
    ).toBe(false);
  });

  it("requires description at all", () => {
    const result = parseSkill(skillMd(["---", "name: a", "---", "Body."]));
    expect(result.ok).toBe(false);
  });

  it("accepts allowed-tools as a space-separated string", () => {
    const result = parseSkill(
      skillMd([
        "---",
        "name: a",
        "description: d",
        "allowed-tools: Read Glob Grep",
        "---",
        "Body.",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.frontmatter["allowed-tools"]).toBe("Read Glob Grep");
  });

  it("accepts allowed-tools as a list", () => {
    const result = parseSkill(
      skillMd([
        "---",
        "name: a",
        "description: d",
        "allowed-tools:",
        "  - Read",
        "  - Glob",
        "---",
        "Body.",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.frontmatter["allowed-tools"]).toEqual(["Read", "Glob"]);
  });

  it("rejects allowed-tools of any other type", () => {
    const result = parseSkill(
      skillMd(["---", "name: a", "description: d", "allowed-tools: 5", "---", "Body."]),
    );
    expect(result.ok).toBe(false);
  });

  it("passes through the documented extra fields unchanged", () => {
    const result = parseSkill(
      skillMd([
        "---",
        "name: a",
        "description: d",
        "license: MIT",
        "compatibility: works everywhere",
        "metadata:",
        "  author: someone",
        "---",
        "Body.",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.frontmatter.license).toBe("MIT");
    expect(result.value.frontmatter.compatibility).toBe("works everywhere");
    expect(result.value.frontmatter.metadata).toEqual({ author: "someone" });
  });

  it("passes through an undocumented field untouched", () => {
    const result = parseSkill(
      skillMd(["---", "name: a", "description: d", "custom_field: hello", "---", "Body."]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.frontmatter["custom_field"]).toBe("hello");
  });

  it("returns the body trimmed", () => {
    const result = parseSkill(
      skillMd(["---", "name: a", "description: d", "---", "", "# Title", "", "Steps.", ""]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.body).toBe("# Title\n\nSteps.");
  });

  it("does not itself check the folder name: that is the loader's job", () => {
    // parseSkill accepts any valid slug for `name`; whether it equals the
    // folder is checked by loadBot, which knows the folder.
    const result = parseSkill(
      skillMd(["---", "name: some-other-name", "description: d", "---", "Body."]),
    );
    expect(result.ok).toBe(true);
  });
});
