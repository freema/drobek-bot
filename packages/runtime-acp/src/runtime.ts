/**
 * Claude Code over ACP, inside a bot's box.
 *
 * The agent is the unmodified `claude` CLI behind the `claude-code-acp`
 * adapter. This package starts it with `Computer.attach`, speaks JSON-RPC over
 * the duplex stdio that gives it, and reads token usage by tailing the
 * transcript the CLI writes. `Computer` is the only way it reaches the box —
 * there is no container runtime in here, and there must never be one.
 *
 * It carries permission requests to the app and answers back (see
 * `permissions.ts` — that is transport, not a gate).
 */
import { randomUUID } from "node:crypto";

import {
  PROTOCOL_VERSION,
  type ClientSideConnection,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  ComputerError,
  RuntimeError,
  type AgentRuntime,
  type ApprovalDecision,
  type AttachedProcess,
  type RunHandle,
  type RuntimeDescription,
  type RuntimeEvent,
  type StartRunInput,
} from "@drobek-bot/core";
import { z } from "zod";

import { connectAcp } from "./acp-client.js";
import { toRuntimeEvents, type ToolCallIndex } from "./events.js";
import { toAcpMcpServers } from "./mcp.js";
import { selectOption, toApprovalRequest } from "./permissions.js";
import { EventQueue } from "./queue.js";
import { pinModel } from "./settings.js";
import { transcriptPath } from "./transcript.js";
import { tailUsage, type TranscriptTail } from "./usage.js";

/** The ACP adapter in the box image; `CMD` of the box, run here as a command. */
const DEFAULT_COMMAND: readonly string[] = ["claude-code-acp"];

/** The box user's home, where the CLI keeps credentials, sessions and transcripts. */
const DEFAULT_HOME = "/home/bot";

/** The bot's project: `CLAUDE.md`, `.claude/`, `.mcp.json` and the bot's files. */
const DEFAULT_CWD = "/home/bot/work";

/**
 * Models this runtime accepts in `StartRunInput.model`. The session response
 * carries the agent's own list and is the authority; this is what the app
 * offers before a session exists.
 */
const DEFAULT_MODELS: readonly string[] = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];

const CLIENT_NAME = "drobek-bot";
const CLIENT_VERSION = "0.0.0";

/** Answered when nobody will decide any more: the run ended or the turn was cancelled. */
const CANCELLED: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

const textSchema = z.string().min(1);

export interface AcpRuntimeOptions {
  /** The agent to start in the box. */
  readonly command?: readonly string[];
  /** The box user's home directory. */
  readonly home?: string;
  /** The session's working directory in the box. */
  readonly cwd?: string;
  /** What `describe()` reports. */
  readonly models?: readonly string[];
}

interface Pending {
  readonly options: readonly PermissionOption[];
  readonly respond: (response: RequestPermissionResponse) => void;
}

/** Everything the ACP handlers touch. Exists before the connection does. */
interface RunInbox {
  readonly events: EventQueue<RuntimeEvent>;
  readonly toolCalls: ToolCallIndex;
  readonly pending: Map<string, Pending>;
  /** `session/load` replays the whole history; the app already has it. */
  replaying: boolean;
  ended: boolean;
}

interface Run {
  readonly runId: string;
  readonly sessionId: string;
  readonly process: AttachedProcess;
  readonly connection: ClientSideConnection;
  readonly inbox: RunInbox;
  readonly tail: TranscriptTail;
  /** The turn in flight, if any. One prompt at a time per session. */
  turn: Promise<void> | undefined;
}

function requireText(value: string, what: string): string {
  const parsed = textSchema.safeParse(value);
  if (!parsed.success) throw new RuntimeError("invalid-input", `${what} must not be empty`);
  return parsed.data;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "the agent failed the turn";
}

/** Answers every permission request still waiting; nobody is going to decide it. */
function cancelPending(inbox: RunInbox): void {
  for (const waiting of inbox.pending.values()) waiting.respond(CANCELLED);
  inbox.pending.clear();
}

export class AcpRuntime implements AgentRuntime {
  readonly #command: readonly string[];
  readonly #home: string;
  readonly #cwd: string;
  readonly #models: readonly string[];
  readonly #runs = new Map<string, Run>();

  constructor(options: AcpRuntimeOptions = {}) {
    this.#command = options.command ?? DEFAULT_COMMAND;
    this.#home = options.home ?? DEFAULT_HOME;
    this.#cwd = options.cwd ?? DEFAULT_CWD;
    this.#models = options.models ?? DEFAULT_MODELS;
  }

  describe(): RuntimeDescription {
    return {
      kind: "claude",
      displayName: "Claude Code",
      models: this.#models,
      auth: "both",
    };
  }

  /**
   * Starts the agent in the box, opens or resumes a session and sends the
   * first prompt. Returns once the session exists — the turn itself is
   * reported through `events`.
   */
  async startRun(input: StartRunInput): Promise<RunHandle> {
    const prompt = requireText(input.prompt, "prompt");
    const resume =
      input.sessionId === undefined ? undefined : requireText(input.sessionId, "sessionId");
    const computer = input.computer;
    if (input.model !== undefined) await pinModel(computer, this.#cwd, input.model);

    const process = await computer.attach(this.#command, { cwd: this.#cwd });
    // Nothing reads the adapter's stderr; an unread pipe would stall the agent.
    process.stderr.resume();

    const inbox: RunInbox = {
      events: new EventQueue<RuntimeEvent>(),
      toolCalls: new Map(),
      pending: new Map(),
      replaying: resume !== undefined,
      ended: false,
    };
    const connection = connectAcp(process.stdin, process.stdout, {
      sessionUpdate: (notification: SessionNotification): Promise<void> => {
        if (!inbox.replaying) {
          for (const event of toRuntimeEvents(notification, inbox.toolCalls)) {
            inbox.events.push(event);
          }
        }
        return Promise.resolve();
      },
      requestPermission: (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        if (inbox.ended) return Promise.resolve(CANCELLED);
        const approvalId = randomUUID();
        return new Promise<RequestPermissionResponse>((resolve) => {
          inbox.pending.set(approvalId, { options: params.options, respond: resolve });
          inbox.events.push(toApprovalRequest(approvalId, params, inbox.toolCalls));
        });
      },
    });

    const exited = process.wait();
    void exited.then(
      (code) => {
        if (inbox.ended) return;
        inbox.ended = true;
        cancelPending(inbox);
        inbox.events.push({ kind: "error", message: `the agent exited with code ${code}` });
        inbox.events.close();
      },
      () => undefined,
    );
    const whileAlive = async <T>(work: Promise<T>): Promise<T> => {
      const gone = exited.then((code) => {
        throw new RuntimeError("unavailable", `the agent exited with code ${code}`);
      });
      return Promise.race([work, gone]);
    };

    try {
      await whileAlive(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          // No `fs/*` and no `terminal/*`: the agent has the box's own files
          // and shell, and the app is not a filesystem for it.
          clientCapabilities: {},
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        }),
      );
      const mcpServers = toAcpMcpServers(input.mcpServers);
      let sessionId: string;
      if (resume === undefined) {
        const created = await whileAlive(connection.newSession({ cwd: this.#cwd, mcpServers }));
        sessionId = created.sessionId;
      } else {
        sessionId = resume;
        await whileAlive(connection.loadSession({ sessionId, cwd: this.#cwd, mcpServers }));
      }
      inbox.replaying = false;
      inbox.events.push({ kind: "session_started", sessionId });

      const tail = await tailUsage(
        computer,
        transcriptPath(this.#home, this.#cwd, sessionId),
        (event) => inbox.events.push(event),
      );
      const run: Run = {
        runId: randomUUID(),
        sessionId,
        process,
        connection,
        inbox,
        tail,
        turn: undefined,
      };
      this.#runs.set(run.runId, run);
      this.#startTurn(run, prompt);
      return { runId: run.runId, sessionId };
    } catch (error) {
      inbox.ended = true;
      cancelPending(inbox);
      inbox.events.close();
      await process.kill().catch(() => undefined);
      if (error instanceof RuntimeError || error instanceof ComputerError) throw error;
      throw new RuntimeError("unavailable", messageOf(error));
    }
  }

  /** Sends a further prompt. Resolves once it is on the wire, not when the turn ends. */
  async sendMessage(handle: RunHandle, text: string): Promise<void> {
    // Yield first, so what follows rejects the promise instead of throwing at
    // the call site — the same way every other method here fails.
    await Promise.resolve();
    const run = this.#require(handle);
    if (run.turn !== undefined) throw new RuntimeError("busy", "a turn is already running");
    this.#startTurn(run, requireText(text, "message"));
  }

  /**
   * Hands a person's answer to the agent. What the agent then does with it is
   * the agent's own business — this does not enforce the decision.
   */
  async resolveApproval(
    handle: RunHandle,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    await Promise.resolve();
    const run = this.#require(handle);
    const waiting = run.inbox.pending.get(approvalId);
    if (waiting === undefined) throw new RuntimeError("unknown-approval", approvalId);
    run.inbox.pending.delete(approvalId);
    const selected = selectOption(decision, waiting.options);
    if (selected === undefined) {
      waiting.respond(CANCELLED);
      throw new RuntimeError("not-supported", `the agent did not offer "${decision}"`);
    }
    waiting.respond({ outcome: { outcome: "selected", optionId: selected.optionId } });
    run.inbox.events.push({
      kind: "approval_resolved",
      approvalId,
      decision: selected.decision,
    });
  }

  /** Cancels the running turn. The session survives it and accepts the next prompt. */
  async interrupt(handle: RunHandle): Promise<void> {
    const run = this.#require(handle);
    // ACP requires every outstanding permission request to be answered
    // `cancelled` when the client cancels the turn.
    cancelPending(run.inbox);
    await run.connection.cancel({ sessionId: run.sessionId });
  }

  events(handle: RunHandle): AsyncIterable<RuntimeEvent> {
    return this.#require(handle).inbox.events;
  }

  async endRun(handle: RunHandle): Promise<void> {
    const run = this.#runs.get(handle.runId);
    if (run === undefined) return;
    this.#runs.delete(run.runId);
    run.inbox.ended = true;
    cancelPending(run.inbox);
    await run.tail.stop();
    await run.process.kill();
    run.inbox.events.close();
  }

  #require(handle: RunHandle): Run {
    const run = this.#runs.get(handle.runId);
    if (run === undefined || run.inbox.ended) {
      throw new RuntimeError("unknown-run", "no such run, or it has ended");
    }
    return run;
  }

  /**
   * One turn, in the background. A denied action ends it: the CLI fails the
   * tool, the adapter interrupts, and `session/prompt` rejects. That is a
   * reported `error` followed by `turn_completed`, never a crash — the session
   * stays usable and the next prompt works.
   */
  #startTurn(run: Run, text: string): void {
    run.turn = (async (): Promise<void> => {
      try {
        const response = await run.connection.prompt({
          sessionId: run.sessionId,
          prompt: [{ type: "text", text }],
        });
        run.inbox.events.push({ kind: "turn_completed", stopReason: response.stopReason });
      } catch (error) {
        run.inbox.events.push({ kind: "error", message: messageOf(error) });
        run.inbox.events.push({ kind: "turn_completed", stopReason: "error" });
      } finally {
        run.turn = undefined;
        cancelPending(run.inbox);
      }
    })();
  }
}
