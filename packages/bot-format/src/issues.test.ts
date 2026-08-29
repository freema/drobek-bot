import { describe, expect, it } from "vitest";

import { fail, formatIssue, ok, pathLabel } from "./issues.js";

describe("ok / fail", () => {
  it("ok wraps a value as a successful result", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("fail wraps issues as a failed result", () => {
    const issues = [{ message: "broken" }];
    expect(fail(issues)).toEqual({ ok: false, issues });
  });
});

describe("pathLabel", () => {
  it("is empty for the document itself", () => {
    expect(pathLabel([])).toBe("");
  });

  it("renders a single key without a leading dot", () => {
    expect(pathLabel(["model"])).toBe("model");
  });

  it("renders nested keys with dots and array indices with brackets", () => {
    expect(pathLabel(["routines", 0, "cron"])).toBe("routines[0].cron");
  });
});

describe("formatIssue", () => {
  it("is just the message when no file is known", () => {
    expect(formatIssue({ message: "something is wrong" })).toBe("something is wrong");
  });

  it("prefixes the file when there is no line", () => {
    expect(formatIssue({ file: "BOT.md", message: "missing" })).toBe("BOT.md missing");
  });

  it("prefixes file:line when both are known", () => {
    expect(formatIssue({ file: "bot.yaml", line: 5, message: "unknown key" })).toBe(
      "bot.yaml:5 unknown key",
    );
  });
});
