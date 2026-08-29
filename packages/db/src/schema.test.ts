import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { runs } from "./schema/index.js";

describe("schema", () => {
  it("declares the runs table", () => {
    expect(getTableName(runs)).toBe("runs");
  });
});
