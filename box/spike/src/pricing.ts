/**
 * Token accounting and the per-run cost cap. Pure: no I/O, no clocks.
 */

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type Pricing = {
  /** USD per million uncached input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
  /** USD per million tokens written to the prompt cache. */
  cacheWritePerMTok: number;
  /** USD per million tokens read from the prompt cache. */
  cacheReadPerMTok: number;
};

function listPrice(inputPerMTok: number, outputPerMTok: number): Pricing {
  // Cache write is 1.25x and cache read 0.1x of the input price.
  return {
    inputPerMTok,
    outputPerMTok,
    cacheWritePerMTok: inputPerMTok * 1.25,
    cacheReadPerMTok: inputPerMTok * 0.1,
  };
}

/** Anthropic list price for claude-haiku-4-5. */
export const HAIKU_4_5_PRICING: Pricing = listPrice(1.0, 5.0);

/**
 * List prices by model id prefix. A run is priced by the model the transcript
 * reports, not the one that was requested; an unknown model is priced at the
 * most expensive tier so the cap errs on the side of stopping.
 */
export const PRICING_BY_MODEL: readonly { prefix: string; pricing: Pricing }[] = [
  { prefix: "claude-haiku-4-5", pricing: HAIKU_4_5_PRICING },
  { prefix: "claude-sonnet-4-6", pricing: listPrice(3.0, 15.0) },
  { prefix: "claude-sonnet-5", pricing: listPrice(2.0, 10.0) },
  { prefix: "claude-opus-4", pricing: listPrice(5.0, 25.0) },
  { prefix: "claude-opus-5", pricing: listPrice(5.0, 25.0) },
  { prefix: "claude-fable-5", pricing: listPrice(10.0, 50.0) },
];

export const FALLBACK_PRICING: Pricing = listPrice(10.0, 50.0);

export function pricingForModel(model: string): Pricing {
  return (
    PRICING_BY_MODEL.find((entry) => model.startsWith(entry.prefix))?.pricing ?? FALLBACK_PRICING
  );
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export function costUsd(usage: TokenUsage, pricing: Pricing): number {
  const perTok = 1 / 1_000_000;
  return (
    usage.inputTokens * pricing.inputPerMTok * perTok +
    usage.outputTokens * pricing.outputPerMTok * perTok +
    usage.cacheWriteTokens * pricing.cacheWritePerMTok * perTok +
    usage.cacheReadTokens * pricing.cacheReadPerMTok * perTok
  );
}

/** One API response as seen in the transcript. */
export type UsageRecord = {
  messageId: string;
  model: string;
  usage: TokenUsage;
};

/**
 * Usage keyed by API message id. Claude Code writes one transcript line per
 * content block of a response, all carrying the same message id and usage, so
 * the last line per id wins and nothing is double counted.
 */
export type UsageLedger = {
  readonly byMessage: ReadonlyMap<string, UsageRecord>;
};

export function emptyLedger(): UsageLedger {
  return { byMessage: new Map() };
}

export function recordUsage(ledger: UsageLedger, record: UsageRecord): UsageLedger {
  const byMessage = new Map(ledger.byMessage);
  byMessage.set(record.messageId, record);
  return { byMessage };
}

export function ledgerTotals(ledger: UsageLedger): TokenUsage {
  let total = ZERO_USAGE;
  for (const record of ledger.byMessage.values()) {
    total = addUsage(total, record.usage);
  }
  return total;
}

export function ledgerModels(ledger: UsageLedger): string[] {
  return [...new Set([...ledger.byMessage.values()].map((r) => r.model))].sort();
}

/** Cost of everything in the ledger, each message at its own model's price. */
export function ledgerCostUsd(ledger: UsageLedger): number {
  let total = 0;
  for (const record of ledger.byMessage.values()) {
    total += costUsd(record.usage, pricingForModel(record.model));
  }
  return total;
}

export type CapCheck = {
  costUsd: number;
  capUsd: number;
  exceeded: boolean;
};

export function checkCap(ledger: UsageLedger, capUsd: number): CapCheck {
  const cost = ledgerCostUsd(ledger);
  return { costUsd: cost, capUsd, exceeded: cost > capUsd };
}
