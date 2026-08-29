import { describe, expect, it } from "vitest";

import { createRedactor } from "./redact.js";

describe("createRedactor", () => {
  it("replaces a value in text with the named marker", () => {
    const redactor = createRedactor([{ name: "GITHUB_TOKEN", value: "ghp_not_a_real_token" }]);
    expect(redactor.redactText("Authorization: token ghp_not_a_real_token\n")).toBe(
      "Authorization: token [REDACTED:GITHUB_TOKEN]\n",
    );
  });
});
