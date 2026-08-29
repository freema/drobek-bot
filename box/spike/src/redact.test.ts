import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact.ts";

describe("redactSecrets", () => {
  it("is a no-op for an undefined secret when the text has nothing key-shaped", () => {
    expect(redactSecrets("hello world", undefined)).toEqual({
      text: "hello world",
      redacted: false,
    });
  });

  it("is a no-op for an empty-string secret when the text has nothing key-shaped", () => {
    expect(redactSecrets("hello world", "")).toEqual({ text: "hello world", redacted: false });
  });

  it("leaves unrelated text untouched", () => {
    expect(redactSecrets("the quick brown fox", "hunter2")).toEqual({
      text: "the quick brown fox",
      redacted: false,
    });
  });

  it("replaces a single occurrence of the secret", () => {
    const result = redactSecrets("token=hunter2 end", "hunter2");
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`token=${REDACTED} end`);
    expect(result.text).not.toContain("hunter2");
  });

  it("replaces every occurrence when the secret appears multiple times", () => {
    const result = redactSecrets("hunter2 and hunter2 again, hunter2!", "hunter2");
    expect(result.redacted).toBe(true);
    expect(result.text).toBe(`${REDACTED} and ${REDACTED} again, ${REDACTED}!`);
    expect(result.text).not.toContain("hunter2");
  });

  it("removes the secret even when it is embedded inside a longer token", () => {
    const result = redactSecrets("password=hunter2xyz", "hunter2");
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain("hunter2");
    expect(result.text).toBe(`password=${REDACTED}xyz`);
  });

  it("treats the secret as a literal string, not a regular expression", () => {
    const secret = "a.b*c";
    const result = redactSecrets(`key=${secret} other=abXc`, secret);
    expect(result.text).toBe(`key=${REDACTED} other=abXc`);
  });

  it("also redacts anything shaped like an Anthropic API key, independent of the given secret", () => {
    const key = "sk-ant-" + "A".repeat(20);
    const result = redactSecrets(`Authorization: Bearer ${key}`, undefined);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain(key);
    expect(result.text).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it("keeps working across repeated calls (no state leaks between invocations)", () => {
    const key1 = "sk-ant-" + "B".repeat(20);
    const key2 = "sk-ant-" + "C".repeat(20);
    const first = redactSecrets(`first ${key1}`, undefined);
    const second = redactSecrets(key2, undefined);
    expect(first.text).not.toContain(key1);
    expect(second.redacted).toBe(true);
    expect(second.text).not.toContain(key2);
  });
});
