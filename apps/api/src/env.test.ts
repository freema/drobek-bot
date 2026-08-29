import { describe, expect, it } from "vitest";

import { envSchema, readEnv } from "./env.js";

const required = { DATABASE_URL: "postgres://localhost/app", REDIS_URL: "redis://localhost" };

describe("readEnv", () => {
  it("parses a full, valid environment", () => {
    const env = readEnv({ ...required, PORT: "4000", GIT_SHA: "abcdef1" });
    expect(env).toEqual({
      PORT: 4000,
      DATABASE_URL: required.DATABASE_URL,
      REDIS_URL: required.REDIS_URL,
      GIT_SHA: "abcdef1",
    });
  });

  it("defaults PORT to 3000 when unset", () => {
    const env = readEnv(required);
    expect(env.PORT).toBe(3000);
  });

  it("defaults GIT_SHA to dev when unset", () => {
    const env = readEnv(required);
    expect(env.GIT_SHA).toBe("dev");
  });

  it("coerces a numeric PORT string to a number", () => {
    const env = readEnv({ ...required, PORT: "8080" });
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe("number");
  });

  it("throws when DATABASE_URL is missing", () => {
    expect(() => readEnv({ REDIS_URL: required.REDIS_URL })).toThrow();
  });

  it("throws when REDIS_URL is missing", () => {
    expect(() => readEnv({ DATABASE_URL: required.DATABASE_URL })).toThrow();
  });

  it("throws when DATABASE_URL is empty", () => {
    expect(() => readEnv({ ...required, DATABASE_URL: "" })).toThrow();
  });

  it("throws when REDIS_URL is empty", () => {
    expect(() => readEnv({ ...required, REDIS_URL: "" })).toThrow();
  });
});

describe("envSchema", () => {
  it("rejects a non-positive PORT", () => {
    const result = envSchema.safeParse({ ...required, PORT: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer PORT", () => {
    const result = envSchema.safeParse({ ...required, PORT: "3000.5" });
    expect(result.success).toBe(false);
  });
});
