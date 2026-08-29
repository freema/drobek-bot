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

/** A transcript being followed. Both calls are safe to make twice. */
export interface TranscriptTail {
  /**
   * Reads the whole transcript once and emits every usage the tail has not
   * delivered yet. The point of the run's last look: `tail -F` is killed with
   * lines still in its buffer, and a turn's usage lands seconds after the turn
   * itself ends, so without this the final line of nearly every run is lost.
   */
  reconcile(): Promise<void>;
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

/**
 * Records what `line` says and hands back the usage when it is news.
 *
 * The one dedupe rule, shared by the seed, the tail and the reconcile: a
 * message is remembered by its id together with its token counts, because the
 * CLI rewrites a message's line as the message grows. An identical line is
 * dropped, a changed one reported.
 */
function accept(seen: Map<string, string>, line: string): TranscriptUsage | undefined {
  const usage = parseTranscriptLine(line);
  if (usage === null) return undefined;
  const key = tokenKey(usage);
  if (seen.get(usage.messageId) === key) return undefined;
  seen.set(usage.messageId, key);
  return usage;
}

/** The transcript's text; empty when the session has not written one yet. */
async function readTranscript(computer: Computer, path: string): Promise<string> {
  try {
    return new TextDecoder().decode(await computer.readFile(path));
  } catch (error) {
    if (error instanceof ComputerError && error.kind === "file-not-found") return "";
    throw error;
  }
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
 * Follows `path` in the box and emits one `usage` event per assistant message,
 * live, while the turn is still running. What counts as news is `accept`'s
 * rule; the run's closing `reconcile` uses the same one, so a line delivered
 * by the tail is never emitted a second time at the end.
 */
export async function tailUsage(
  computer: Computer,
  path: string,
  emit: (event: RuntimeEvent) => void,
): Promise<TranscriptTail> {
  const seen = new Map<string, string>();
  // Whatever is already there belongs to earlier runs: recorded, not emitted.
  for (const line of (await readTranscript(computer, path)).split("\n")) {
    accept(seen, line);
  }

  const process = await computer.attach(["tail", "-n", "+1", "-F", path]);
  process.stderr.resume();
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line: string) => {
    const usage = accept(seen, line);
    if (usage !== undefined) emit(toEvent(usage));
  });

  let stopped = false;
  return {
    async reconcile(): Promise<void> {
      for (const line of (await readTranscript(computer, path)).split("\n")) {
        const usage = accept(seen, line);
        if (usage !== undefined) emit(toEvent(usage));
      }
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      lines.close();
      await process.kill();
    },
  };
}
