import { describe, expect, it } from "vitest";

import { formatStatusLine } from "./health";

describe("formatStatusLine", () => {
  it("says unreachable when the api could not be read", () => {
    expect(formatStatusLine({ kind: "unreachable" })).toBe("api: unreachable");
  });
});
