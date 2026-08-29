import { describe, expect, it } from "vitest";

import { createRedactor, redactionToken } from "./redact.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("createRedactor", () => {
  it("replaces a value in text with the named marker", () => {
    const redactor = createRedactor([{ name: "GITHUB_TOKEN", value: "ghp_not_a_real_token" }]);
    expect(redactor.redactText("Authorization: token ghp_not_a_real_token\n")).toBe(
      "Authorization: token [REDACTED:GITHUB_TOKEN]\n",
    );
  });
});

describe("createRedactor: the canary test", () => {
  const CANARY = "drobek-canary-f3a1c9b7";
  const NAME = "GITHUB_TOKEN";

  /**
   * A fake event stream: nested objects and arrays, the value inside a string
   * that is itself a JSON-encoded object, a log line, a base64-encoded blob,
   * a URL with the value query-encoded, and an object whose *key* carries it.
   */
  function buildEvent(canary: string): Record<string, unknown> {
    const encoded = encodeURIComponent(canary);
    const base64 = Buffer.from(canary, "utf8").toString("base64");
    const encodedInner = JSON.stringify({ token: canary });
    return {
      kind: "tool_call",
      payload: {
        headers: { Authorization: `Bearer ${canary}` },
        logLine: `[INFO] using token ${canary} for the request\n`,
        nested: {
          deep: [
            { message: `raw value seen: ${canary}` },
            { encodedBody: encodedInner },
            [canary, `wrapped(${canary})`],
          ],
        },
        url: `https://example.com/callback?token=${encoded}&other=1`,
        blob: base64,
        [`meta-${canary}`]: "a value under a key that carries the secret",
      },
    };
  }

  it("removes every encoded form of the secret from a realistic event stream", () => {
    const redactor = createRedactor([{ name: NAME, value: CANARY }]);
    const event = buildEvent(CANARY);
    const before = JSON.stringify(event);

    const redacted = redactor.redactValue(event);
    const serialized = JSON.stringify(redacted);

    const encoded = encodeURIComponent(CANARY);
    const base64 = Buffer.from(CANARY, "utf8").toString("base64");
    const jsonEscaped = JSON.stringify(CANARY).slice(1, -1);

    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain(jsonEscaped);
    expect(serialized).not.toContain(encoded);
    expect(serialized).not.toContain(base64);
    expect(serialized).toContain(redactionToken(NAME));

    // The input object is not mutated.
    expect(JSON.stringify(event)).toBe(before);
  });
});

describe("createRedactor: text without any secret", () => {
  it("returns unrelated text unchanged", () => {
    const redactor = createRedactor([{ name: "GITHUB_TOKEN", value: "ghp_abcdefgh12345" }]);
    const text = "nothing sensitive here, just an ordinary log line";
    expect(redactor.redactText(text)).toBe(text);
  });
});

describe("createRedactor: input is not mutated", () => {
  it("returns a copy, leaving the original object and its nested values untouched", () => {
    const redactor = createRedactor([{ name: "TOKEN", value: "leak-me" }]);
    const original = { outer: { inner: ["leak-me", "keep-me"] } };
    const snapshot = JSON.stringify(original);

    const redacted = redactor.redactValue(original);

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(redacted).not.toBe(original);
  });
});

describe("createRedactor: longest form first", () => {
  it("prefers the longer value's token when one value is a prefix of another", () => {
    const redactor = createRedactor([
      { name: "SHORT", value: "abc" },
      { name: "LONG", value: "abcdef" },
    ]);
    expect(redactor.redactText("abcdef")).toBe(redactionToken("LONG"));
  });

  it("still redacts the shorter value on its own, elsewhere in the text", () => {
    const redactor = createRedactor([
      { name: "SHORT", value: "abc" },
      { name: "LONG", value: "abcdef" },
    ]);
    const result = redactor.redactText("abcdef and abc alone");
    expect(result).toBe(`${redactionToken("LONG")} and ${redactionToken("SHORT")} alone`);
  });
});

describe("createRedactor: empty and short values", () => {
  it("ignores an empty secret value without throwing", () => {
    const redactor = createRedactor([{ name: "EMPTY", value: "" }]);
    expect(() => redactor.redactText("hello world")).not.toThrow();
    expect(redactor.redactText("hello world")).toBe("hello world");
  });

  it("redacts a one-character value", () => {
    const redactor = createRedactor([{ name: "ONE", value: "z" }]);
    expect(redactor.redactText("xyz")).toBe(`xy${redactionToken("ONE")}`);
  });
});

describe("createRedactor: lone surrogates do not throw", () => {
  it("does not throw when a secret value is a lone surrogate", () => {
    const redactor = createRedactor([{ name: "SURROGATE", value: "\uD800" }]);
    expect(() => redactor.redactText("before \uD800 after")).not.toThrow();
  });

  it("does not throw when the text being redacted contains a lone surrogate", () => {
    const redactor = createRedactor([{ name: "NORMAL", value: "secret-value" }]);
    expect(() => redactor.redactText("before \uD800 secret-value after")).not.toThrow();
    expect(redactor.redactText("before \uD800 secret-value after")).toBe(
      `before \uD800 ${redactionToken("NORMAL")} after`,
    );
  });
});

describe("createRedactor: values that pass through untouched", () => {
  it("returns a Date unchanged, by reference", () => {
    const redactor = createRedactor([{ name: "X", value: "secret" }]);
    const when = new Date("2024-01-01T00:00:00.000Z");
    const result = redactor.redactValue({ when });
    expect(isRecord(result)).toBe(true);
    if (isRecord(result)) {
      expect(result.when).toBe(when);
    }
  });
});

describe("createRedactor: cyclic input", () => {
  it("does not hang on a self-referencing object", () => {
    const redactor = createRedactor([{ name: "X", value: "secret-value" }]);
    const cyclic: Record<string, unknown> = { a: "secret-value" };
    cyclic.self = cyclic;

    const result = redactor.redactValue(cyclic);

    expect(isRecord(result)).toBe(true);
    if (isRecord(result)) {
      expect(result.self).toBe(result);
      expect(result.a).toBe(redactionToken("X"));
    }
  });

  it("does not hang on a cyclic array", () => {
    const redactor = createRedactor([{ name: "X", value: "secret-value" }]);
    const cyclic: unknown[] = ["secret-value"];
    cyclic.push(cyclic);

    const result = redactor.redactValue(cyclic);

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result[1]).toBe(result);
      expect(result[0]).toBe(redactionToken("X"));
    }
  });
});
