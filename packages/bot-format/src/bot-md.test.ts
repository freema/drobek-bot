import { describe, expect, it } from "vitest";

import { parseBotMd } from "./bot-md.js";

function botMd(lines: readonly string[]): string {
  return lines.join("\n");
}

describe("parseBotMd", () => {
  it("parses exactly name, job and language, and returns the body verbatim as the system prompt", () => {
    const text = botMd([
      "---",
      "name: Inbox briefing",
      "job: Turns the inbox into a briefing.",
      "language: cs",
      "---",
      "",
      "## Identity",
      "",
      "You are the inbox briefing bot.",
      "",
    ]);
    const result = parseBotMd(text);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.identity).toEqual({
      name: "Inbox briefing",
      job: "Turns the inbox into a briefing.",
      language: "cs",
    });
    // The body is trimmed of the surrounding blank lines but otherwise verbatim.
    expect(result.value.body).toBe("## Identity\n\nYou are the inbox briefing bot.");
  });

  it("reports a missing frontmatter block with a line number", () => {
    const result = parseBotMd("Just a plain Markdown file, no frontmatter.\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { line: 1, message: "expected YAML frontmatter: the first line must be ---" },
    ]);
  });

  it("reports a missing key", () => {
    const text = botMd(["---", "name: X", "job: Y", "---", "", "Body."]);
    const result = parseBotMd(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.message.includes("language"))).toBe(true);
    expect(result.issues.every((issue) => typeof issue.line === "number")).toBe(true);
  });

  it("reports an extra key with its name and a line number", () => {
    const text = botMd([
      "---",
      "name: X",
      "job: Y",
      "language: en",
      "extra: not allowed",
      "---",
      "",
      "Body.",
    ]);
    const result = parseBotMd(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const issue = result.issues.find((candidate) => candidate.message.includes("unknown key"));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("extra");
    expect(issue?.line).toBe(5);
  });

  it("reports every missing and every extra key together, not just the first", () => {
    const text = botMd(["---", "name: X", "extra: nope", "---", "", "Body."]);
    const result = parseBotMd(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.message.includes("job"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("language"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("extra"))).toBe(true);
  });

  it("reports an unterminated frontmatter block", () => {
    const text = botMd(["---", "name: X", "job: Y", "language: en"]);
    const result = parseBotMd(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { line: 1, message: "unterminated frontmatter: no closing --- line" },
    ]);
  });

  it("reports a body that is empty after the frontmatter", () => {
    const text = botMd(["---", "name: X", "job: Y", "language: en", "---", ""]);
    const result = parseBotMd(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((issue) => issue.message.includes("no body"))).toBe(true);
  });
});
