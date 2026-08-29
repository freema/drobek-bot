import { describe, expect, it } from "vitest";
import {
  FALLBACK_PRICING,
  HAIKU_4_5_PRICING,
  ZERO_USAGE,
  addUsage,
  checkCap,
  costUsd,
  emptyLedger,
  ledgerCostUsd,
  ledgerModels,
  ledgerTotals,
  pricingForModel,
  recordUsage,
  type TokenUsage,
  type UsageRecord,
} from "./pricing.ts";

function usage(overrides: Partial<TokenUsage>): TokenUsage {
  return { ...ZERO_USAGE, ...overrides };
}

describe("HAIKU_4_5_PRICING", () => {
  it("matches the published list price for claude-haiku-4-5", () => {
    expect(HAIKU_4_5_PRICING).toEqual({
      inputPerMTok: 1.0,
      outputPerMTok: 5.0,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
    });
  });
});

describe("costUsd", () => {
  it("is zero for zero usage", () => {
    expect(costUsd(ZERO_USAGE, HAIKU_4_5_PRICING)).toBe(0);
  });

  it("prices a million input tokens at the input rate", () => {
    expect(costUsd(usage({ inputTokens: 1_000_000 }), HAIKU_4_5_PRICING)).toBeCloseTo(1.0, 10);
  });

  it("prices a million output tokens at the output rate", () => {
    expect(costUsd(usage({ outputTokens: 1_000_000 }), HAIKU_4_5_PRICING)).toBeCloseTo(5.0, 10);
  });

  it("prices a million cache-read tokens at the cache-read rate", () => {
    expect(costUsd(usage({ cacheReadTokens: 1_000_000 }), HAIKU_4_5_PRICING)).toBeCloseTo(0.1, 10);
  });

  it("prices a million cache-write tokens at the cache-write rate", () => {
    expect(costUsd(usage({ cacheWriteTokens: 1_000_000 }), HAIKU_4_5_PRICING)).toBeCloseTo(
      1.25,
      10,
    );
  });

  it("is non-negative for arbitrary positive usage", () => {
    const cost = costUsd(
      { inputTokens: 12_345, outputTokens: 678, cacheReadTokens: 9, cacheWriteTokens: 1 },
      HAIKU_4_5_PRICING,
    );
    expect(cost).toBeGreaterThanOrEqual(0);
  });

  it("is additive across usage records", () => {
    const a = usage({ inputTokens: 100_000, outputTokens: 20_000 });
    const b = usage({ inputTokens: 300_000, cacheReadTokens: 50_000 });
    const combined = addUsage(a, b);
    const sumOfCosts = costUsd(a, HAIKU_4_5_PRICING) + costUsd(b, HAIKU_4_5_PRICING);
    expect(costUsd(combined, HAIKU_4_5_PRICING)).toBeCloseTo(sumOfCosts, 10);
  });
});

describe("addUsage", () => {
  it("sums each field independently", () => {
    const a: TokenUsage = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
    };
    const b: TokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40,
    };
    expect(addUsage(a, b)).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheWriteTokens: 44,
    });
  });

  it("is a no-op when adding zero usage", () => {
    const a: TokenUsage = {
      inputTokens: 5,
      outputTokens: 6,
      cacheReadTokens: 7,
      cacheWriteTokens: 8,
    };
    expect(addUsage(a, ZERO_USAGE)).toEqual(a);
  });
});

describe("pricingForModel", () => {
  it("prices claude-haiku-4-5, and dated variants of it, at the haiku rate", () => {
    expect(pricingForModel("claude-haiku-4-5")).toEqual(HAIKU_4_5_PRICING);
    expect(pricingForModel("claude-haiku-4-5-20260101")).toEqual(HAIKU_4_5_PRICING);
  });

  it("falls back to the most expensive tier for an unknown model", () => {
    expect(pricingForModel("some-future-model")).toEqual(FALLBACK_PRICING);
  });
});

describe("ledger", () => {
  it("totals to zero usage and zero cost when empty", () => {
    expect(ledgerTotals(emptyLedger())).toEqual(ZERO_USAGE);
    expect(ledgerCostUsd(emptyLedger())).toBe(0);
  });

  it("keeps only the latest usage for a repeated message id, so nothing is double counted", () => {
    const record1: UsageRecord = {
      messageId: "msg-1",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 1_000_000 }),
    };
    const record2: UsageRecord = {
      messageId: "msg-1",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 2_000_000 }),
    };
    let ledger = emptyLedger();
    ledger = recordUsage(ledger, record1);
    ledger = recordUsage(ledger, record2);
    expect(ledgerTotals(ledger)).toEqual(usage({ inputTokens: 2_000_000 }));
  });

  it("sums usage across distinct messages", () => {
    let ledger = emptyLedger();
    ledger = recordUsage(ledger, {
      messageId: "msg-1",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 1_000_000 }),
    });
    ledger = recordUsage(ledger, {
      messageId: "msg-2",
      model: "claude-haiku-4-5",
      usage: usage({ outputTokens: 500_000 }),
    });
    expect(ledgerTotals(ledger)).toEqual(usage({ inputTokens: 1_000_000, outputTokens: 500_000 }));
  });

  it("returns the sorted set of distinct models seen", () => {
    let ledger = emptyLedger();
    ledger = recordUsage(ledger, { messageId: "a", model: "claude-opus-4", usage: ZERO_USAGE });
    ledger = recordUsage(ledger, { messageId: "b", model: "claude-haiku-4-5", usage: ZERO_USAGE });
    ledger = recordUsage(ledger, { messageId: "c", model: "claude-haiku-4-5", usage: ZERO_USAGE });
    expect(ledgerModels(ledger)).toEqual(["claude-haiku-4-5", "claude-opus-4"]);
  });

  it("prices each message at its own model's rate", () => {
    let ledger = emptyLedger();
    ledger = recordUsage(ledger, {
      messageId: "a",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens: 1_000_000 }),
    });
    ledger = recordUsage(ledger, {
      messageId: "b",
      model: "unknown-future-model",
      usage: usage({ inputTokens: 1_000_000 }),
    });
    const expected =
      costUsd(usage({ inputTokens: 1_000_000 }), HAIKU_4_5_PRICING) +
      costUsd(usage({ inputTokens: 1_000_000 }), FALLBACK_PRICING);
    expect(ledgerCostUsd(ledger)).toBeCloseTo(expected, 10);
  });
});

describe("checkCap", () => {
  function ledgerWithInputTokens(inputTokens: number) {
    return recordUsage(emptyLedger(), {
      messageId: "a",
      model: "claude-haiku-4-5",
      usage: usage({ inputTokens }),
    });
  }

  it("is not exceeded when there is no usage, even against a zero cap", () => {
    expect(checkCap(emptyLedger(), 0)).toEqual({ costUsd: 0, capUsd: 0, exceeded: false });
  });

  it("is exceeded by any non-zero usage against a zero cap", () => {
    expect(checkCap(ledgerWithInputTokens(1), 0).exceeded).toBe(true);
  });

  it("is not exceeded when cost is strictly under the cap", () => {
    // 500,000 input tokens at $1/MTok = $0.50, under a $1 cap.
    expect(checkCap(ledgerWithInputTokens(500_000), 1.0).exceeded).toBe(false);
  });

  it("is not exceeded when cost exactly equals the cap", () => {
    // 1,000,000 input tokens at $1/MTok = $1.00 exactly.
    const check = checkCap(ledgerWithInputTokens(1_000_000), 1.0);
    expect(check.costUsd).toBeCloseTo(1.0, 10);
    expect(check.exceeded).toBe(false);
  });

  it("is exceeded once cost passes the cap", () => {
    expect(checkCap(ledgerWithInputTokens(1_000_001), 1.0).exceeded).toBe(true);
  });
});
