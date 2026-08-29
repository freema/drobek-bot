/**
 * Parsing of Claude Code's session transcript (~/.claude/projects/<cwd>/<id>.jsonl).
 * The ACP adapter does not forward usage or cost, so the host reads them from
 * the transcript the CLI writes inside the box. Pure: takes a line, returns a
 * record or null.
 */
import { z } from "zod";
import type { UsageRecord } from "./pricing.ts";

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
});

const assistantLineSchema = z.object({
  type: z.literal("assistant"),
  version: z.string().optional(),
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: usageSchema.optional(),
  }),
});

export type TranscriptUsage = UsageRecord & {
  /** Claude Code version that wrote the line, when present. */
  cliVersion: string | undefined;
};

/**
 * Returns the usage carried by an assistant transcript line, or null for any
 * other line (user messages, summaries, synthetic messages, malformed input).
 */
export function parseTranscriptLine(line: string): TranscriptUsage | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = assistantLineSchema.safeParse(json);
  if (!parsed.success) return null;
  const { message, version } = parsed.data;
  if (message.id === undefined || message.usage === undefined) return null;
  const model = message.model ?? "unknown";
  if (model === "<synthetic>") return null;
  const u = message.usage;
  return {
    messageId: message.id,
    model,
    cliVersion: version,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/** Where Claude Code stores the transcript for a session started in `cwd`. */
export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return `${home}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}
