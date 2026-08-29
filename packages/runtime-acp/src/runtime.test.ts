/**
 * `AcpRuntime` driven entirely through the public `AgentRuntime` port, over
 * real ACP JSON-RPC framing carried by two fakes: a fake `Computer` (in-memory
 * streams and an in-memory file store standing in for the box) and a fake ACP
 * agent (a real `AgentSideConnection` speaking the protocol on the other end
 * of those streams). Nothing here reaches into `runtime.ts`, `permissions.ts`,
 * `events.ts`, `usage.ts` or `settings.ts` — every assertion is against
 * `RuntimeEvent`s, `RuntimeError` kinds, and what the fake `Computer` observed.
 */
import { PassThrough, type Readable, type Writable } from "node:stream";

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type CancelNotification,
  type NewSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type StopReason,
} from "@agentclientprotocol/sdk";
import {
  ComputerError,
  RuntimeError,
  type AttachedProcess,
  type CommandResult,
  type Computer,
  type FileEntry,
  type RuntimeEvent,
} from "@drobek-bot/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AcpRuntime, SETTINGS_FILE } from "./index.js";

const SESSION_ID = "session-1";

/** A promise this test controls the settling of. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

/** One process the fake `Computer` handed out: the pipes plus what happened to it. */
interface TrackedProcess {
  readonly proc: AttachedProcess;
  readonly killCalls: (string | undefined)[];
}

function trackedAttached(stdin: Writable, stdout: Readable): TrackedProcess {
  let resolveExit: ((code: number) => void) | undefined;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const killCalls: (string | undefined)[] = [];
  const proc: AttachedProcess = {
    stdin,
    stdout,
    stderr: new PassThrough(),
    wait: () => exit,
    kill: (signal?: string) => {
      killCalls.push(signal);
      if (!stdout.destroyed) stdout.push(null);
      if (!stdin.destroyed) stdin.end();
      resolveExit?.(0);
      return Promise.resolve();
    },
  };
  return { proc, killCalls };
}

interface FakeAgentHandlers {
  readonly prompt: (
    params: PromptRequest,
    connection: AgentSideConnection,
    callIndex: number,
  ) => Promise<{ stopReason: StopReason }>;
  readonly newSession?: (params: NewSessionRequest) => { sessionId: string };
  readonly onCancel?: (params: CancelNotification) => void;
}

/** A real ACP agent (a real `AgentSideConnection`) over in-memory streams. */
function createFakeAgentProcess(handlers: FakeAgentHandlers): TrackedProcess {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  let callIndex = 0;
  const connect = (connection: AgentSideConnection): Agent => ({
    initialize: () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }),
    authenticate: () => ({}),
    newSession: (params) =>
      Promise.resolve(handlers.newSession?.(params) ?? { sessionId: SESSION_ID }),
    prompt: (params) => handlers.prompt(params, connection, callIndex++),
    cancel: (params) => {
      handlers.onCancel?.(params);
    },
  });
  new AgentSideConnection(connect, ndJsonStream(toWebWritable(fromAgent), toWebReadable(toAgent)));
  return trackedAttached(toAgent, fromAgent);
}

/** A box: one agent process, plus a transcript tail per attach that isn't the agent. */
interface FakeComputer {
  readonly computer: Computer;
  readonly agentProcesses: TrackedProcess[];
  readonly transcriptProcesses: TrackedProcess[];
  readonly writeCalls: { path: string; text: string }[];
  readonly operationLog: string[];
  pushTranscriptLine(line: string): void;
  seedFile(path: string, content: string): void;
}

function createFakeComputer(agentFactory: () => TrackedProcess): FakeComputer {
  const agentProcesses: TrackedProcess[] = [];
  const transcriptProcesses: TrackedProcess[] = [];
  const transcriptStreams: PassThrough[] = [];
  const writeCalls: { path: string; text: string }[] = [];
  const operationLog: string[] = [];
  const files = new Map<string, Uint8Array>();

  /** Settings-file paths may or may not be exactly `SETTINGS_FILE`; match by suffix either way. */
  function settingsKey(path: string): string {
    return path === SETTINGS_FILE || path.endsWith(SETTINGS_FILE) ? SETTINGS_FILE : path;
  }

  const computer: Computer = {
    id: "bot",
    runCommand: (): Promise<CommandResult> => {
      operationLog.push("runCommand");
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    },
    attach: (argv: readonly string[]): Promise<AttachedProcess> => {
      if (argv[0] === "claude-code-acp") {
        operationLog.push("attach:agent");
        const tracked = agentFactory();
        agentProcesses.push(tracked);
        return Promise.resolve(tracked.proc);
      }
      operationLog.push("attach:transcript");
      const stdout = new PassThrough();
      transcriptStreams.push(stdout);
      const tracked = trackedAttached(new PassThrough(), stdout);
      transcriptProcesses.push(tracked);
      return Promise.resolve(tracked.proc);
    },
    readFile: (path: string): Promise<Uint8Array> => {
      operationLog.push("readFile");
      const content = files.get(settingsKey(path));
      if (content === undefined) return Promise.reject(new ComputerError("file-not-found"));
      return Promise.resolve(content);
    },
    writeFile: (path: string, bytes: Uint8Array): Promise<void> => {
      operationLog.push("writeFile");
      files.set(settingsKey(path), bytes);
      writeCalls.push({ path, text: Buffer.from(bytes).toString("utf8") });
      return Promise.resolve();
    },
    listFiles: (): Promise<readonly FileEntry[]> => Promise.resolve([]),
  };

  return {
    computer,
    agentProcesses,
    transcriptProcesses,
    writeCalls,
    operationLog,
    pushTranscriptLine: (line: string) => {
      const stream = transcriptStreams.at(-1);
      if (stream === undefined) throw new Error("no transcript process attached yet");
      stream.write(`${line}\n`);
    },
    seedFile: (path: string, content: string) => {
      files.set(settingsKey(path), new TextEncoder().encode(content));
    },
  };
}

async function collectUntil(
  iterator: AsyncIterator<RuntimeEvent>,
  stopWhen: (event: RuntimeEvent) => boolean,
): Promise<RuntimeEvent[]> {
  const seen: RuntimeEvent[] = [];
  for (;;) {
    const result = await iterator.next();
    if (result.done === true) return seen;
    seen.push(result.value);
    if (stopWhen(result.value)) return seen;
  }
}

const isTurnCompleted = (event: RuntimeEvent): boolean => event.kind === "turn_completed";
const collectTurn = (iterator: AsyncIterator<RuntimeEvent>): Promise<RuntimeEvent[]> =>
  collectUntil(iterator, isTurnCompleted);

function expectApprovalRequest(
  events: readonly RuntimeEvent[],
): Extract<RuntimeEvent, { kind: "approval_request" }> {
  const found = events.at(-1);
  if (found === undefined || found.kind !== "approval_request") {
    throw new Error("expected the last collected event to be an approval_request");
  }
  return found;
}

describe("AcpRuntime", () => {
  it("describes itself", () => {
    expect(new AcpRuntime().describe().kind).toBe("claude");
  });

  it("runs a successful turn to exactly one completion", async () => {
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "hmm" },
            },
          });
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "List files",
              kind: "search",
              status: "pending",
              rawInput: { path: "." },
            },
          });
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed" },
          });
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "done" },
            },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "list files" });
    expect(handle.sessionId).toBe(SESSION_ID);

    const iterator = runtime.events(handle)[Symbol.asyncIterator]();
    const turn = await collectTurn(iterator);

    expect(turn).toContainEqual({ kind: "session_started", sessionId: SESSION_ID });
    expect(turn).toContainEqual({ kind: "text_delta", text: "done" });
    expect(turn.some((e) => e.kind === "tool_call" && e.toolCallId === "tc-1")).toBe(true);
    expect(turn.some((e) => e.kind === "error")).toBe(false);
    expect(turn.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(turn.at(-1)).toEqual({ kind: "turn_completed", stopReason: "end_turn" });

    await runtime.endRun(handle);
  });

  it("ends an errored turn with exactly one error and one completion, and the session stays usable after", async () => {
    let promptCalls = 0;
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          promptCalls += 1;
          if (promptCalls === 1) throw new Error("agent crashed");
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "recovered" },
            },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "hi" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const turn1 = await collectTurn(iterator);
    expect(turn1.filter((e) => e.kind === "error")).toHaveLength(1);
    expect(turn1.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    const errorIndex = turn1.findIndex((e) => e.kind === "error");
    const completedIndex = turn1.findIndex((e) => e.kind === "turn_completed");
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(errorIndex).toBeLessThan(completedIndex);

    await runtime.sendMessage(handle, "try again");
    const turn2 = await collectTurn(iterator);
    expect(turn2[0]?.kind).not.toBe("turn_completed");
    expect(turn2.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(turn2).toContainEqual({ kind: "text_delta", text: "recovered" });
    expect(turn2.some((e) => e.kind === "error")).toBe(false);
    expect(promptCalls).toBe(2);

    await runtime.endRun(handle);
  });

  it("ends a turn whose tool call was rejected with exactly one error and one completion, and the session stays usable after", async () => {
    let promptCalls = 0;
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          promptCalls += 1;
          if (promptCalls === 1) {
            await connection.sessionUpdate({
              sessionId: params.sessionId,
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "tc-1",
                title: "Delete file",
                kind: "delete",
                status: "pending",
                rawInput: { path: "notes.txt" },
              },
            });
            const options: PermissionOption[] = [
              { optionId: "opt-allow", name: "Allow", kind: "allow_once" },
              { optionId: "opt-reject", name: "Reject", kind: "reject_once" },
            ];
            const response = await connection.requestPermission({
              sessionId: params.sessionId,
              toolCall: { toolCallId: "tc-1" },
              options,
            });
            if (
              response.outcome.outcome !== "selected" ||
              response.outcome.optionId !== "opt-reject"
            ) {
              throw new Error("expected reject_once to have been selected");
            }
            throw new Error("tool call rejected by the user");
          }
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "after denial" },
            },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "delete notes.txt" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const upToApproval = await collectUntil(iterator, (e) => e.kind === "approval_request");
    const request = expectApprovalRequest(upToApproval);
    await runtime.resolveApproval(handle, request.approvalId, "reject_once");

    const turn1 = await collectTurn(iterator);
    expect(turn1).toContainEqual({
      kind: "approval_resolved",
      approvalId: request.approvalId,
      decision: "reject_once",
    });
    expect(turn1.filter((e) => e.kind === "error")).toHaveLength(1);
    expect(turn1.filter((e) => e.kind === "turn_completed")).toHaveLength(1);

    await runtime.sendMessage(handle, "try something else");
    const turn2 = await collectTurn(iterator);
    expect(turn2[0]?.kind).not.toBe("turn_completed");
    expect(turn2.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(turn2.some((e) => e.kind === "error")).toBe(false);
    expect(turn2).toContainEqual({ kind: "text_delta", text: "after denial" });

    await runtime.endRun(handle);
  });

  it("downgrades allow_always to the allow_once option the agent actually offered, and reports what was applied", async () => {
    const selectedOptionIds: string[] = [];
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "Write file",
              kind: "edit",
              status: "pending",
              rawInput: {},
            },
          });
          const options: PermissionOption[] = [
            { optionId: "opt-once", name: "Allow once", kind: "allow_once" },
          ];
          const response = await connection.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: "tc-1" },
            options,
          });
          if (response.outcome.outcome !== "selected") throw new Error("permission cancelled");
          selectedOptionIds.push(response.outcome.optionId);
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId: "tc-1", status: "completed" },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "write" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const upToApproval = await collectUntil(iterator, (e) => e.kind === "approval_request");
    const request = expectApprovalRequest(upToApproval);
    await runtime.resolveApproval(handle, request.approvalId, "allow_always");

    const turn = await collectTurn(iterator);
    expect(turn).toContainEqual({
      kind: "approval_resolved",
      approvalId: request.approvalId,
      decision: "allow_once",
    });
    expect(turn.some((e) => e.kind === "error")).toBe(false);
    expect(turn.filter((e) => e.kind === "turn_completed")).toHaveLength(1);

    // The option that actually reached the agent over the wire — never invented.
    expect(selectedOptionIds).toEqual(["opt-once"]);

    await runtime.endRun(handle);
  });

  it("downgrades reject_always to the reject_once option the agent actually offered, and reports what was applied", async () => {
    const selectedOptionIds: string[] = [];
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "Run a command",
              kind: "execute",
              status: "pending",
              rawInput: {},
            },
          });
          const options: PermissionOption[] = [
            { optionId: "opt-once", name: "Reject once", kind: "reject_once" },
          ];
          const response = await connection.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: "tc-1" },
            options,
          });
          if (response.outcome.outcome !== "selected") throw new Error("permission cancelled");
          selectedOptionIds.push(response.outcome.optionId);
          throw new Error("tool call rejected by the user");
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "run it" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const upToApproval = await collectUntil(iterator, (e) => e.kind === "approval_request");
    const request = expectApprovalRequest(upToApproval);
    await runtime.resolveApproval(handle, request.approvalId, "reject_always");

    const turn = await collectTurn(iterator);
    expect(turn).toContainEqual({
      kind: "approval_resolved",
      approvalId: request.approvalId,
      decision: "reject_once",
    });
    expect(turn.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(selectedOptionIds).toEqual(["opt-once"]);

    await runtime.endRun(handle);
  });

  it("does not invent a decision when the agent offers no matching option", async () => {
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "tc-1",
              title: "Run a command",
              kind: "execute",
              status: "pending",
              rawInput: {},
            },
          });
          const options: PermissionOption[] = [
            { optionId: "opt-reject-once", name: "Reject once", kind: "reject_once" },
            { optionId: "opt-reject-always", name: "Reject always", kind: "reject_always" },
          ];
          // Only reject options are offered; nothing in this test should ever select one.
          await connection.requestPermission({
            sessionId: params.sessionId,
            toolCall: { toolCallId: "tc-1" },
            options,
          });
          throw new Error("unreachable: the permission request should never resolve in this test");
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "run it" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const upToApproval = await collectUntil(iterator, (e) => e.kind === "approval_request");
    const request = expectApprovalRequest(upToApproval);

    let caught: unknown;
    try {
      await runtime.resolveApproval(handle, request.approvalId, "allow_once");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    if (!(caught instanceof RuntimeError)) throw new Error("expected a RuntimeError");
    expect(caught.kind).toBe("not-supported");

    await runtime.endRun(handle);
  });

  it("refuses sendMessage while a turn is running, without dispatching it to the agent", async () => {
    const started = deferred<void>();
    const gate = deferred<void>();
    let promptCalls = 0;
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          promptCalls += 1;
          if (promptCalls === 1) {
            started.resolve();
            await gate.promise;
            return { stopReason: "end_turn" };
          }
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "second" },
            },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "first" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    // Wait until the first prompt has genuinely reached the agent before proving the
    // second one is refused — otherwise "busy" could trivially hold for the wrong reason.
    await started.promise;

    let caught: unknown;
    try {
      await runtime.sendMessage(handle, "second, too soon");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuntimeError);
    if (!(caught instanceof RuntimeError)) throw new Error("expected a RuntimeError");
    expect(caught.kind).toBe("busy");
    expect(promptCalls).toBe(1);

    gate.resolve();
    const turn1 = await collectTurn(iterator);
    expect(turn1.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(promptCalls).toBe(1);

    await runtime.sendMessage(handle, "now it should work");
    const turn2 = await collectTurn(iterator);
    expect(turn2.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
    expect(promptCalls).toBe(2);

    await runtime.endRun(handle);
  });

  it("emits no usage event when the transcript tail stays silent", async () => {
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hello" },
            },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "hi" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();
    const turn = await collectTurn(iterator);

    expect(turn.some((e) => e.kind === "usage")).toBe(false);
    expect(turn.filter((e) => e.kind === "turn_completed")).toHaveLength(1);

    await runtime.endRun(handle);
  });

  it("reports usage from a transcript line fed through the box mid-turn, not from protocol traffic", async () => {
    const proceed = deferred<void>();
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "partial" },
            },
          });
          await proceed.promise;
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "hi" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();

    const beforeTranscript = await collectUntil(iterator, (e) => e.kind === "text_delta");
    expect(beforeTranscript.some((e) => e.kind === "usage")).toBe(false);

    fake.pushTranscriptLine(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          model: "claude-haiku-4-5",
          usage: {
            input_tokens: 11,
            output_tokens: 22,
            cache_read_input_tokens: 33,
            cache_creation_input_tokens: 44,
          },
        },
      }),
    );

    const mid = await collectUntil(iterator, (e) => e.kind === "usage");
    expect(mid.at(-1)).toEqual({
      kind: "usage",
      model: "claude-haiku-4-5",
      inputTokens: 11,
      outputTokens: 22,
      cacheReadTokens: 33,
      cacheWriteTokens: 44,
    });

    proceed.resolve();
    const rest = await collectTurn(iterator);
    expect(rest.filter((e) => e.kind === "turn_completed")).toHaveLength(1);

    const all = [...beforeTranscript, ...mid, ...rest];
    expect(all.filter((e) => e.kind === "usage")).toHaveLength(1);

    await runtime.endRun(handle);
  });

  it("endRun kills the agent process and the transcript tail, and is safe to call twice", async () => {
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({ computer: fake.computer, prompt: "hi" });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();
    await collectTurn(iterator);

    expect(fake.agentProcesses.length).toBeGreaterThan(0);
    expect(fake.transcriptProcesses.length).toBeGreaterThan(0);
    for (const tracked of [...fake.agentProcesses, ...fake.transcriptProcesses]) {
      expect(tracked.killCalls).toHaveLength(0);
    }

    await runtime.endRun(handle);

    for (const tracked of [...fake.agentProcesses, ...fake.transcriptProcesses]) {
      expect(tracked.killCalls.length).toBeGreaterThan(0);
      await expect(tracked.proc.wait()).resolves.toBe(0);
    }

    await expect(runtime.endRun(handle)).resolves.toBeUndefined();
  });

  it("merges a model pin into an existing .claude/settings.json instead of replacing it", async () => {
    const fake = createFakeComputer(() =>
      createFakeAgentProcess({
        prompt: async (params, connection) => {
          await connection.sessionUpdate({
            sessionId: params.sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
          });
          return { stopReason: "end_turn" };
        },
      }),
    );
    fake.seedFile(
      SETTINGS_FILE,
      JSON.stringify({ existingKey: "existingValue", permissions: { foo: "bar" } }),
    );

    const runtime = new AcpRuntime();
    const handle = await runtime.startRun({
      computer: fake.computer,
      prompt: "hi",
      model: "claude-haiku-4-5",
    });
    const iterator = runtime.events(handle)[Symbol.asyncIterator]();
    await collectTurn(iterator);
    await runtime.endRun(handle);

    const write = fake.writeCalls.find(
      (w) => w.path === SETTINGS_FILE || w.path.endsWith(SETTINGS_FILE),
    );
    if (write === undefined) throw new Error("the settings file was never written");

    const settingsSchema = z.object({
      model: z.string(),
      existingKey: z.string(),
      permissions: z.object({ foo: z.string() }),
    });
    const written = settingsSchema.parse(JSON.parse(write.text));
    expect(written.model).toBe("claude-haiku-4-5");
    expect(written.existingKey).toBe("existingValue");
    expect(written.permissions.foo).toBe("bar");

    // The pin has to land before the CLI starts reading settings, or it never takes effect.
    const writeIndex = fake.operationLog.indexOf("writeFile");
    const agentAttachIndex = fake.operationLog.indexOf("attach:agent");
    expect(writeIndex).toBeGreaterThanOrEqual(0);
    expect(agentAttachIndex).toBeGreaterThanOrEqual(0);
    expect(writeIndex).toBeLessThan(agentAttachIndex);
  });
});
