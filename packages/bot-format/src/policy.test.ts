import { describe, expect, it } from "vitest";

import { isToolNamePattern, matchesToolPattern } from "./index.js";
import { decideApproval } from "./policy.js";

describe("isToolNamePattern", () => {
  it("accepts an exact tool name", () => {
    expect(isToolNamePattern("Bash")).toBe(true);
    expect(isToolNamePattern("mcp__github__create_issue")).toBe(true);
  });

  it("accepts a prefix ending in a single trailing *", () => {
    expect(isToolNamePattern("mcp__github__*")).toBe(true);
  });

  it("accepts * alone", () => {
    expect(isToolNamePattern("*")).toBe(true);
  });

  it("rejects a * that is not at the end", () => {
    expect(isToolNamePattern("*foo")).toBe(false);
    expect(isToolNamePattern("foo*bar")).toBe(false);
  });

  it("rejects more than one trailing *", () => {
    expect(isToolNamePattern("foo**")).toBe(false);
  });

  it("rejects a pattern containing whitespace", () => {
    expect(isToolNamePattern("mcp github")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isToolNamePattern("")).toBe(false);
  });
});

describe("matchesToolPattern", () => {
  it("matches an exact tool name only against itself", () => {
    expect(matchesToolPattern("Bash", "Bash")).toBe(true);
    expect(matchesToolPattern("Bash2", "Bash")).toBe(false);
  });

  it("mcp__github__* matches names under that server but not another server", () => {
    expect(matchesToolPattern("mcp__github__create_issue", "mcp__github__*")).toBe(true);
    expect(matchesToolPattern("mcp__gitlab__x", "mcp__github__*")).toBe(false);
  });

  it("* matches everything", () => {
    expect(matchesToolPattern("Bash", "*")).toBe(true);
    expect(matchesToolPattern("mcp__anything__at_all", "*")).toBe(true);
    expect(matchesToolPattern("", "*")).toBe(true);
  });
});

describe("decideApproval: precedence", () => {
  it("deny wins over require and allow when all three list the tool", () => {
    const decision = decideApproval("Bash", {
      deny: ["Bash"],
      require: ["Bash"],
      allow: ["Bash"],
    });
    expect(decision).toBe("deny");
  });

  it("require wins over allow when both list the tool", () => {
    const decision = decideApproval("Bash", { require: ["Bash"], allow: ["Bash"] });
    expect(decision).toBe("require_approval");
  });

  it("allow applies when only allow lists the tool", () => {
    const decision = decideApproval("Read", { allow: ["Read"] });
    expect(decision).toBe("allow");
  });

  it("is undefined for a tool no pattern matches", () => {
    const decision = decideApproval("WebFetch", {
      deny: ["mcp__github__delete_*"],
      require: ["Bash"],
      allow: ["Read"],
    });
    expect(decision).toBeUndefined();
  });

  it("is undefined when the policy lists nothing at all", () => {
    expect(decideApproval("Bash", {})).toBeUndefined();
  });

  it("matches via prefix patterns in any of the three lists", () => {
    expect(decideApproval("mcp__github__delete_issue", { deny: ["mcp__github__delete_*"] })).toBe(
      "deny",
    );
    expect(
      decideApproval("mcp__github__create_issue", { require: ["mcp__github__create_*"] }),
    ).toBe("require_approval");
    expect(decideApproval("mcp__github__get_issue", { allow: ["mcp__github__get_*"] })).toBe(
      "allow",
    );
  });
});
