import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, decide } from "./policy.ts";

describe("decide", () => {
  it("denies a tool the policy does not name", () => {
    const decision = decide(
      { toolCallId: "1", toolName: "Bash", kind: "execute", title: "`rm -rf /`", rawInput: {} },
      DEFAULT_POLICY,
    );
    expect(decision).toBe("deny");
  });
});
