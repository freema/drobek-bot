import { describe, expect, it } from "vitest";
import type { PermissionOption } from "@agentclientprotocol/sdk";
import {
  ALLOW_ALL,
  DEFAULT_POLICY,
  DENY_ALL,
  decide,
  matchesPattern,
  selectOption,
  type Policy,
  type PermissionRequestView,
} from "./policy.ts";

function requestFor(
  toolName: string | undefined,
  overrides: Partial<PermissionRequestView> = {},
): PermissionRequestView {
  return {
    toolCallId: "call-1",
    toolName,
    kind: undefined,
    title: "",
    rawInput: {},
    ...overrides,
  };
}

describe("decide", () => {
  it("denies a tool the policy does not name", () => {
    const decision = decide(
      { toolCallId: "1", toolName: "Bash", kind: "execute", title: "`rm -rf /`", rawInput: {} },
      DEFAULT_POLICY,
    );
    expect(decision).toBe("deny");
  });

  it("allows a tool named exactly in the allowlist", () => {
    const policy: Policy = { allow: ["Read", "Write"] };
    expect(decide(requestFor("Write"), policy)).toBe("allow");
  });

  it("denies every tool when the allowlist is empty", () => {
    expect(decide(requestFor("Read"), DENY_ALL)).toBe("deny");
    expect(decide(requestFor("Bash"), DENY_ALL)).toBe("deny");
    expect(decide(requestFor(""), DENY_ALL)).toBe("deny");
  });

  it("allows everything when the policy is the bare wildcard", () => {
    expect(decide(requestFor("Bash"), ALLOW_ALL)).toBe("allow");
    expect(decide(requestFor("mcp__playwright__browser_navigate"), ALLOW_ALL)).toBe("allow");
  });

  it("allows a tool matched by a prefix wildcard but not an unrelated tool", () => {
    const policy: Policy = { allow: ["mcp__playwright__*"] };
    expect(decide(requestFor("mcp__playwright__browser_navigate"), policy)).toBe("allow");
    expect(decide(requestFor("mcp__other__thing"), policy)).toBe("deny");
  });

  it("denies an unknown tool name even under a wildcard policy", () => {
    expect(decide(requestFor(undefined), DEFAULT_POLICY)).toBe("deny");
    expect(decide(requestFor(undefined), ALLOW_ALL)).toBe("deny");
  });

  it("is a pure function of (tool name, allowlist): same input, same output", () => {
    const policy: Policy = { allow: ["Bash", "Read"] };
    const request = requestFor("Bash");
    expect(decide(request, policy)).toBe(decide(request, policy));
    expect(decide(request, policy)).toBe("allow");
  });

  it("never throws for empty or unusual tool names", () => {
    const policy: Policy = { allow: ["Bash"] };
    expect(() => decide(requestFor(""), policy)).not.toThrow();
    expect(() => decide(requestFor("a".repeat(500)), policy)).not.toThrow();
    expect(() => decide(requestFor("mcp__weird.tool/name:1"), policy)).not.toThrow();
    expect(decide(requestFor(""), policy)).toBe("deny");
  });
});

describe("matchesPattern", () => {
  it("matches the bare wildcard against any name", () => {
    expect(matchesPattern("Bash", "*")).toBe(true);
    expect(matchesPattern("", "*")).toBe(true);
  });

  it("matches a prefix pattern only as a prefix", () => {
    expect(matchesPattern("mcp__playwright__click", "mcp__playwright__*")).toBe(true);
    expect(matchesPattern("mcp__playwrightX", "mcp__playwright__*")).toBe(false);
  });

  it("requires an exact match when there is no trailing wildcard", () => {
    expect(matchesPattern("Read", "Read")).toBe(true);
    expect(matchesPattern("Reader", "Read")).toBe(false);
  });
});

describe("selectOption", () => {
  const options: PermissionOption[] = [
    { optionId: "allow-once-id", name: "Allow once", kind: "allow_once" },
    { optionId: "allow-always-id", name: "Allow always", kind: "allow_always" },
    { optionId: "reject-once-id", name: "Reject once", kind: "reject_once" },
    { optionId: "reject-always-id", name: "Reject always", kind: "reject_always" },
  ];

  it("maps an allow decision to the one-shot allow option, never the standing one", () => {
    expect(selectOption("allow", options)).toBe("allow-once-id");
  });

  it("maps a deny decision to the one-shot reject option, never the standing one", () => {
    expect(selectOption("deny", options)).toBe("reject-once-id");
  });

  it("returns undefined when the agent did not offer the wanted option kind", () => {
    const onlyAlways: PermissionOption[] = [
      { optionId: "allow-always-id", name: "Allow always", kind: "allow_always" },
    ];
    expect(selectOption("allow", onlyAlways)).toBeUndefined();
  });
});
