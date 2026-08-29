import { describe, expect, it } from "vitest";

import { assembleHealth } from "./health.js";

describe("assembleHealth", () => {
  it("reports ok when every check is ok", () => {
    const response = assembleHealth(
      { version: "0.0.0", commit: "dev" },
      { postgres: "ok", redis: "ok", worker: "ok" },
    );
    expect(response.status).toBe("ok");
  });
});
