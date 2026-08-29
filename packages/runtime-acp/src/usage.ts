/**
 * Token usage, read from the transcript the CLI writes inside the box.
 *
 * `tail -F` on the session's transcript is the only source: the ACP adapter
 * forwards no usage at all. Lines arrive while the turn is still running, so
 * usage is live rather than a post-mortem. What the numbers cost, and what
 * happens when a run gets expensive, is not decided here.
 */
import { createInterface } from "node:readline";

import { ComputerError, type Computer, type RuntimeEvent } from "@drobek-bot/core";

import { parseTranscriptLine, type TranscriptUsage } from "./transcript.js";

/** A transcript being followed. `stop` is safe to call twice. */
export interface TranscriptTail {
  stop(): Promise<void>;
}

function tokenKey(usage: TranscriptUsage): string {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
  ].join(":");
}

function toEvent(usage: TranscriptUsage): RuntimeEvent {
  return {
    kind: "usage",
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

/**
 * Follows `path` in the box and emits one `usage` event per assistant message.
 *
 * The CLI rewrites a message's line as the message grows, and a resumed
 * session's transcript already holds every earlier turn, so what has been seen
 * is remembered by message id and token counts: a repeated line is silently
 * dropped, a changed one reported. Lines already in the file when the tail
 * starts belong to earlier runs and are seeded, not emitted.
 */
export async function tailUsage(
  computer: Computer,
  path: string,
  emit: (event: RuntimeEvent) => void,
): Promise<TranscriptTail> {
  const seen = new Map<string, string>();
  let existing = "";
  try {
    existing = new TextDecoder().decode(await computer.readFile(path));
  } catch (error) {
    // A new session has no transcript until the first turn writes one.
    if (!(error instanceof ComputerError) || error.kind !== "file-not-found") throw error;
  }
  for (const line of existing.split("\n")) {
    const usage = parseTranscriptLine(line);
    if (usage !== null) seen.set(usage.messageId, tokenKey(usage));
  }

  const process = await computer.attach(["tail", "-n", "+1", "-F", path]);
  process.stderr.resume();
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line: string) => {
    const usage = parseTranscriptLine(line);
    if (usage === null) return;
    const key = tokenKey(usage);
    if (seen.get(usage.messageId) === key) return;
    seen.set(usage.messageId, key);
    emit(toEvent(usage));
  });

  let stopped = false;
  return {
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      lines.close();
      await process.kill();
    },
  };
}
