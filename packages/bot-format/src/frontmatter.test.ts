import { describe, expect, it } from "vitest";

import { splitFrontmatter } from "./frontmatter.js";

describe("splitFrontmatter", () => {
  it("splits the yaml between the fences from the body after them", () => {
    const lines = ["---", "name: X", "job: Y", "---", "", "Body line one.", "Body line two."];
    const result = splitFrontmatter(lines.join("\n"));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.yaml).toBe("name: X\njob: Y");
    expect(result.value.body).toBe("\nBody line one.\nBody line two.");
    expect(result.value.yamlStartLine).toBe(2);
  });

  it("fails when the first line is not the opening fence", () => {
    const text = ["not a fence", "---", "name: X", "---", "Body"].join("\n");
    const result = splitFrontmatter(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { line: 1, message: "expected YAML frontmatter: the first line must be ---" },
    ]);
  });

  it("fails when there is no closing fence", () => {
    const text = ["---", "name: X", "job: Y"].join("\n");
    const result = splitFrontmatter(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { line: 1, message: "unterminated frontmatter: no closing --- line" },
    ]);
  });

  it("accepts an empty yaml block between adjacent fences", () => {
    const text = ["---", "---", "Body"].join("\n");
    const result = splitFrontmatter(text);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.yaml).toBe("");
    expect(result.value.body).toBe("Body");
  });

  it("normalizes CRLF line endings the same way as LF", () => {
    const text = "---\r\nname: X\r\n---\r\nBody here\r\n";
    const result = splitFrontmatter(text);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.yaml).toBe("name: X");
    expect(result.value.body).toBe("Body here\n");
  });

  it("only treats a line that is exactly --- as a fence", () => {
    // "----" is not a closing fence; the real closing fence is the next line.
    const text = ["---", "name: X", "----", "---", "Body"].join("\n");
    const result = splitFrontmatter(text);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.yaml).toBe("name: X\n----");
    expect(result.value.body).toBe("Body");
  });
});
