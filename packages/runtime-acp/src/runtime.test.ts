/**
 * Smoke: one run against a fake agent speaking real ACP over real streams, in
 * a fake box. It exists to prove the wiring runs at all — the suite for this
 * package is written separately.
 */
import { PassThrough, type Readable, type Writable } from "node:stream";

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type PromptRequest,
} from "@agentclientprotocol/sdk";
import {
  ComputerError,
  type AttachedProcess,
  type CommandResult,
  type Computer,
  type FileEntry,
  type RuntimeEvent,
} from "@drobek-bot/core";
import { describe, expect, it } from "vitest";

import { AcpRuntime } from "./runtime.js";

const SESSION_ID = "session-1";

const TRANSCRIPT_LINE = JSON.stringify({
  type: "assistant",
  message: {
    id: "msg_1",
    model: "claude-haiku-4-5",
    usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33 },
  },
});

function toWebWritable(stream: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    },
  });
}

function toWebReadable(stream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      stream.on("end", () => controller.close());
    },
  });
}

function attached(stdin: Writable, stdout: Readable): AttachedProcess {
  let done: ((code: number) => void) | undefined;
  const exit = new Promise<number>((resolve) => {
    done = resolve;
  });
  return {
    stdin,
    stdout,
    stderr: new PassThrough(),
    wait: () => exit,
    kill: () => {
      stdout.push(null);
      done?.(0);
      return Promise.resolve();
    },
  };
}

/** An ACP agent that answers one prompt with one message chunk. */
function fakeAgent(): AttachedProcess {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const connect = (connection: AgentSideConnection): Agent => ({
    initialize: () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
    authenticate: () => ({}),
    newSession: () => ({ sessionId: SESSION_ID }),
    prompt: async (params: PromptRequest) => {
      await connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      });
      return { stopReason: "end_turn" };
    },
    cancel: () => undefined,
  });
  new AgentSideConnection(connect, ndJsonStream(toWebWritable(fromAgent), toWebReadable(toAgent)));
  return attached(toAgent, fromAgent);
}

/** A box with one agent and one transcript. */
function fakeComputer(): Computer {
  return {
    id: "bot",
    runCommand: (): Promise<CommandResult> =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    attach: (argv: readonly string[]): Promise<AttachedProcess> => {
      if (argv[0] === "claude-code-acp") return Promise.resolve(fakeAgent());
      const stdout = new PassThrough();
      setTimeout(() => stdout.write(`${TRANSCRIPT_LINE}\n`), 0);
      return Promise.resolve(attached(new PassThrough(), stdout));
    },
    readFile: () => Promise.reject(new ComputerError("file-not-found")),
    writeFile: () => Promise.resolve(),
    listFiles: (): Promise<readonly FileEntry[]> => Promise.resolve([]),
  };
}

async function take(events: AsyncIterable<RuntimeEvent>, count: number): Promise<RuntimeEvent[]> {
  const seen: RuntimeEvent[] = [];
  for await (const event of events) {
    seen.push(event);
    if (seen.length === count) break;
  }
  return seen;
}

describe("AcpRuntime", () => {
  it("runs a turn and reports the session, the text and the usage", async () => {
    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fakeComputer(), prompt: "hi" });
    expect(handle.sessionId).toBe(SESSION_ID);

    const events = await take(runtime.events(handle), 4);
    expect(events).toContainEqual({ kind: "session_started", sessionId: SESSION_ID });
    expect(events).toContainEqual({ kind: "text_delta", text: "hello" });
    expect(events).toContainEqual({
      kind: "usage",
      model: "claude-haiku-4-5",
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheWriteTokens: 0,
    });
    expect(events).toContainEqual({ kind: "turn_completed", stopReason: "end_turn" });

    await runtime.endRun(handle);
  });

  it("describes itself", () => {
    expect(new AcpRuntime().describe().kind).toBe("claude");
  });
});
