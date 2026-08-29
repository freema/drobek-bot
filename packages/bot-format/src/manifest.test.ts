import { describe, expect, it } from "vitest";

import { isValidCron } from "./index.js";
import { parseManifest } from "./manifest.js";

function manifest(lines: readonly string[]): string {
  return lines.join("\n");
}

const MINIMAL = manifest(["version: 1", "model: claude-haiku-4-5"]);

describe("parseManifest: version and model", () => {
  it("requires version to be exactly 1", () => {
    expect(parseManifest(manifest(["version: 2", "model: x"])).ok).toBe(false);
    expect(parseManifest(manifest(['version: "1"', "model: x"])).ok).toBe(false);
  });

  it("reports version missing", () => {
    expect(parseManifest(manifest(["model: x"])).ok).toBe(false);
  });

  it("requires model", () => {
    expect(parseManifest(manifest(["version: 1"])).ok).toBe(false);
  });

  it("rejects an empty model", () => {
    expect(parseManifest(manifest(["version: 1", "model: ''"])).ok).toBe(false);
  });
});

describe("parseManifest: defaults", () => {
  it("fills in every other section's default when only version and model are given", () => {
    const result = parseManifest(MINIMAL);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value).toEqual({
      version: 1,
      model: "claude-haiku-4-5",
      browser: "host-cdp",
      requires: [],
      secrets: [],
      mcp: {},
      routines: [],
    });
  });
});

describe("parseManifest: unknown keys", () => {
  it("reports an unknown top-level key with its name and line", () => {
    const result = parseManifest(manifest(["version: 1", "model: x", "bogus: true"]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([{ message: "bogus: unknown key", line: 3, path: ["bogus"] }]);
  });

  it("reports an unknown key nested under budget", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "budget:", "  per_run_usd: 0.1", "  bogus_field: true"]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { message: "budget.bogus_field: unknown key", line: 5, path: ["budget", "bogus_field"] },
    ]);
  });

  it("reports an unknown key nested under policy.approvals", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "policy:",
        "  approvals:",
        "    deny: []",
        "    extra: []",
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: "policy.approvals.extra: unknown key",
        line: 6,
        path: ["policy", "approvals", "extra"],
      },
    ]);
  });

  it("reports an unknown key nested inside a routine", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: r",
        '    cron: "0 0 * * *"',
        "    prompt: a",
        "    extra_field: true",
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: "routines[0].extra_field: unknown key",
        line: 7,
        path: ["routines", 0, "extra_field"],
      },
    ]);
  });
});

describe("parseManifest: auth", () => {
  it("accepts subscription and api_key", () => {
    expect(parseManifest(manifest(["version: 1", "model: x", "auth: subscription"])).ok).toBe(true);
    expect(parseManifest(manifest(["version: 1", "model: x", "auth: api_key"])).ok).toBe(true);
  });

  it("rejects anything else", () => {
    const result = parseManifest(manifest(["version: 1", "model: x", "auth: oauth"]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.line).toBe(3);
    expect(result.issues[0]?.path).toEqual(["auth"]);
  });
});

describe("parseManifest: browser", () => {
  it("defaults to host-cdp when omitted", () => {
    const result = parseManifest(MINIMAL);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.browser).toBe("host-cdp");
  });

  it("accepts the other declared modes", () => {
    expect(parseManifest(manifest(["version: 1", "model: x", "browser: none"])).ok).toBe(true);
    expect(parseManifest(manifest(["version: 1", "model: x", "browser: box"])).ok).toBe(true);
  });

  it("rejects an undeclared mode", () => {
    expect(parseManifest(manifest(["version: 1", "model: x", "browser: chrome"])).ok).toBe(false);
  });
});

describe("parseManifest: requires", () => {
  it("defaults to an empty list", () => {
    const result = parseManifest(MINIMAL);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.requires).toEqual([]);
  });

  it("accepts a declared list of tool names", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "requires:", "  - gh", "  - glab"]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.requires).toEqual(["gh", "glab"]);
  });
});

describe("parseManifest: channels", () => {
  it("accepts any object for now, reserved for a later feature", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "channels:", "  slack:", "    workspace: abc"]),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseManifest: mcp entries", () => {
  it("accepts the remote { url, type? } shape, defaulting type to unset", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "mcp:", "  svc:", "    url: https://example.com/mcp"]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.mcp.svc).toEqual({ url: "https://example.com/mcp" });
  });

  it("accepts an explicit remote type", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "mcp:",
        "  svc:",
        "    url: https://example.com/mcp",
        "    type: sse",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.mcp.svc).toEqual({ url: "https://example.com/mcp", type: "sse" });
  });

  it("accepts the stdio { command, args?, env? } shape", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "mcp:",
        "  svc:",
        "    command: npx",
        "    args:",
        "      - -y",
        "      - pkg",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.mcp.svc).toEqual({ command: "npx", args: ["-y", "pkg"] });
  });

  it("accepts the { catalog } reference shape", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "mcp:", "  svc:", "    catalog: github"]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.mcp.svc).toEqual({ catalog: "github" });
  });

  it("reports an entry that is none of the three shapes, with its location", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "mcp:", "  bad1:", "    foo: bar"]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: "mcp.bad1: expected { url, type? }, { command, args?, env? } or { catalog }",
        line: 5,
        path: ["mcp", "bad1"],
      },
    ]);
  });

  it("rejects an entry mixing fields from more than one shape", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "mcp:",
        "  bad2:",
        "    url: https://example.com",
        "    command: npx",
      ]),
    );
    expect(result.ok).toBe(false);
  });
});

describe("parseManifest: routine cron", () => {
  it("rejects a minute field out of bounds", () => {
    expect(isValidCron("60 * * * *")).toBe(false);
  });

  it("accepts a step-and-range expression", () => {
    expect(isValidCron("*/15 9-17 * * 1-5")).toBe(true);
  });

  it("requires exactly five fields", () => {
    expect(isValidCron("0 0 * *")).toBe(false);
    expect(isValidCron("0 0 * * * *")).toBe(false);
  });

  it("does not accept month or day names, or macros", () => {
    expect(isValidCron("0 0 1 JAN *")).toBe(false);
    expect(isValidCron("@daily")).toBe(false);
  });

  it("accepts 7 and rejects 8 for day-of-week (0 and 7 both mean Sunday)", () => {
    expect(isValidCron("0 0 * * 7")).toBe(true);
    expect(isValidCron("0 0 * * 8")).toBe(false);
  });

  it("reports an invalid cron on the routine with its location", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: r",
        '    cron: "60 * * * *"',
        "    prompt: a",
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message:
          "routines[0].cron: expected five cron fields (minute hour day-of-month month day-of-week)",
        line: 5,
        path: ["routines", 0, "cron"],
      },
    ]);
  });
});

describe("parseManifest: routine timezone", () => {
  it("defaults to Europe/Prague when omitted", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: r",
        '    cron: "0 0 * * *"',
        "    prompt: a",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.routines[0]?.timezone).toBe("Europe/Prague");
  });

  it("accepts a real IANA zone", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: r",
        '    cron: "0 0 * * *"',
        "    prompt: a",
        "    timezone: America/New_York",
      ]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.routines[0]?.timezone).toBe("America/New_York");
  });

  it("rejects a zone the runtime does not know, with its location", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: r",
        '    cron: "0 0 * * *"',
        "    prompt: a",
        "    timezone: Not/AZone",
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: "routines[0].timezone: expected an IANA time zone such as Europe/Prague",
        line: 7,
        path: ["routines", 0, "timezone"],
      },
    ]);
  });
});

describe("parseManifest: routine names unique", () => {
  it("reports a duplicate routine name with its location", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: same",
        '    cron: "0 0 * * *"',
        "    prompt: a",
        "  - name: same",
        '    cron: "0 1 * * *"',
        "    prompt: b",
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: 'routines[1].name: duplicate routine name "same"',
        line: 7,
        path: ["routines", 1, "name"],
      },
    ]);
  });

  it("accepts distinct routine names", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "routines:",
        "  - name: a",
        '    cron: "0 0 * * *"',
        "    prompt: a",
        "  - name: b",
        '    cron: "0 1 * * *"',
        "    prompt: b",
      ]),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseManifest: budget", () => {
  it("leaves both fields optional", () => {
    expect(parseManifest(manifest(["version: 1", "model: x", "budget: {}"])).ok).toBe(true);
    expect(
      parseManifest(manifest(["version: 1", "model: x", "budget:", "  per_run_usd: 0.25"])).ok,
    ).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(
      parseManifest(manifest(["version: 1", "model: x", "budget:", "  per_run_usd: -1"])).ok,
    ).toBe(false);
    expect(
      parseManifest(manifest(["version: 1", "model: x", "budget:", "  per_day_usd: -0.5"])).ok,
    ).toBe(false);
  });

  it("accepts zero, a non-negative amount", () => {
    const result = parseManifest(
      manifest(["version: 1", "model: x", "budget:", "  per_run_usd: 0"]),
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseManifest: policy.approvals patterns", () => {
  it("accepts exact, prefix and wildcard patterns", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "policy:",
        "  approvals:",
        "    deny:",
        "      - Bash",
        "      - mcp__github__delete_*",
        "    allow:",
        "      - '*'",
      ]),
    );
    expect(result.ok).toBe(true);
  });

  it("reports a malformed pattern with its location", () => {
    const result = parseManifest(
      manifest([
        "version: 1",
        "model: x",
        "policy:",
        "  approvals:",
        "    allow:",
        '      - "mcp github"',
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        message: "policy.approvals.allow[0]: expected a tool name, a prefix ending in * or * alone",
        line: 6,
        path: ["policy", "approvals", "allow", 0],
      },
    ]);
  });
});
