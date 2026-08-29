/**
 * Parsing of Claude Code's session transcript (`~/.claude/projects/<cwd>/<id>.jsonl`).
 *
 * The ACP adapter forwards neither usage nor cost — it drops the CLI's `result`
 * message and never sends `usage_update` — so token counts are read from the
 * transcript the CLI writes inside the box. Pure: takes a line, returns a
 * record or null.
 */
import { z } from "zod";

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().default(0),
  output_tokens: z.number().int().nonnegative().default(0),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
});

const assistantLineSchema = z.object({
  type: z.literal("assistant"),
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: usageSchema.optional(),
  }),
});

export interface TranscriptUsage {
  /** The API message the tokens were billed to; the same id can be written twice. */
  readonly messageId: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/**
 * The usage carried by an assistant transcript line, or null for any other
 * line (user messages, summaries, synthetic messages, malformed input).
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
  const { message } = parsed.data;
  if (message.id === undefined || message.usage === undefined) return null;
  const model = message.model ?? "unknown";
  if (model === "<synthetic>") return null;
  const usage = message.usage;
  return {
    messageId: message.id,
    model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Where Claude Code stores the transcript of a session started in `cwd`. */
export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return `${home}/.claude/projects/${encoded}/${sessionId}.jsonl`;
}
