import type { ClaudeMcpServer } from "@drobek-bot/contracts";

import type { Computer } from "./computer.js";

/**
 * The port an agent runtime is reached through: one conversation with one
 * coding agent, running inside one bot's box. Types and interfaces only — the
 * ACP implementation lives in `@drobek-bot/runtime-acp`, and no other package
 * may import an agent protocol SDK.
 *
 * A runtime transports what the agent says and carries the human's answers
 * back. It is not the approval gate: an `approval_request` event means the
 * agent asked, and nothing more. What actually stops a tool from running is
 * decided elsewhere, and the runtime never sees the actions the agent's own
 * permission engine lets through.
 */

/** The four answers a person can give, in the agent's own vocabulary. */
export type ApprovalDecision = "allow_once" | "allow_always" | "reject_once" | "reject_always";

/**
 * Everything one run tells the app, in the order it happened.
 *
 * `turn_completed` ends every turn exactly once, including a turn that failed
 * (a failed turn is preceded by an `error` with the reason). It says the
 * model's turn ended. It does **not** say the stream is finished, and it is
 * not a safe place to stop reading.
 *
 * In particular, the `usage` of a turn normally arrives *after* that turn's
 * `turn_completed`, seconds later: token counts are read from the agent's
 * transcript rather than from the protocol, and the transcript line lands on
 * its own schedule. A consumer that stops iterating on `turn_completed`
 * therefore loses the usage of every turn it ever sees, silently — which
 * quietly turns spend accounting into an undercount and a spend cap into no
 * cap at all.
 *
 * The stream ends when `endRun` closes it. That is the only end there is —
 * and it carries the guarantee worth relying on: **when the stream closes, the
 * run's `usage` is complete.** `endRun` reads the agent's transcript one last
 * time and emits whatever had not been delivered yet, before closing. So a
 * consumer that drains to the end has every token the run spent; one that
 * stops earlier has an undercount, and no amount of waiting fixes it.
 */
export type RuntimeEvent =
  | { readonly kind: "session_started"; readonly sessionId: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "text_delta"; readonly text: string }
  | {
      readonly kind: "tool_call";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly title: string;
      readonly input: unknown;
    }
  | {
      readonly kind: "tool_call_update";
      readonly toolCallId: string;
      readonly status: string;
      readonly output?: unknown;
    }
  | {
      readonly kind: "approval_request";
      readonly approvalId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly title: string;
      readonly input: unknown;
    }
  | {
      readonly kind: "approval_resolved";
      readonly approvalId: string;
      readonly decision: ApprovalDecision;
    }
  | {
      readonly kind: "screenshot";
      readonly toolCallId: string;
      readonly mimeType: string;
      readonly data: string;
    }
  /** May arrive after the `turn_completed` of the turn that spent it. */
  | {
      readonly kind: "usage";
      readonly model: string;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheReadTokens: number;
      readonly cacheWriteTokens: number;
    }
  | { readonly kind: "turn_completed"; readonly stopReason: string }
  | { readonly kind: "error"; readonly message: string };

/** What a runtime is and what it can be signed in with. */
export interface RuntimeDescription {
  /** Stable identifier, e.g. `claude`. */
  readonly kind: string;
  readonly displayName: string;
  /** Model ids the runtime accepts in `StartRunInput.model`. */
  readonly models: readonly string[];
  readonly auth: "subscription" | "api-key" | "both";
}

/** One run: a first prompt on a new or resumed session in a bot's box. */
export interface StartRunInput {
  /** The box the agent runs in. The runtime reaches it only through this. */
  readonly computer: Computer;
  /** The first prompt of the run. */
  readonly prompt: string;
  /** Pins the model for this run; without it the box's own setting stands. */
  readonly model?: string;
  /** Resumes the agent's session of that id instead of starting a new one. */
  readonly sessionId?: string;
  /** Servers the app adds for this run, on top of what the box is configured with. */
  readonly mcpServers?: Readonly<Record<string, ClaudeMcpServer>>;
}

/** A started run. `sessionId` is what a later `StartRunInput` resumes. */
export interface RunHandle {
  /** Unique for the lifetime of the runtime instance. */
  readonly runId: string;
  /** The agent's own session id, known once the session exists. */
  readonly sessionId: string;
}

/**
 * One agent runtime. Claude over ACP is the first; another agent is another
 * implementation of this interface, not another integration.
 *
 * `events` is consumed once per run. Every method but `startRun` takes the
 * handle `startRun` returned.
 */
export interface AgentRuntime {
  describe(): RuntimeDescription;
  startRun(input: StartRunInput): Promise<RunHandle>;
  /** A further prompt on the same session. Fails while a turn is running. */
  sendMessage(run: RunHandle, text: string): Promise<void>;
  /** Answers an `approval_request`. The agent, not this call, applies it. */
  resolveApproval(run: RunHandle, approvalId: string, decision: ApprovalDecision): Promise<void>;
  /** Cancels the running turn. The session stays usable. */
  interrupt(run: RunHandle): Promise<void>;
  /**
   * The run's events, from the first one. Consumed once, and ended only by
   * `endRun` — never by `turn_completed`, which leaves that turn's `usage`
   * still to come.
   */
  events(run: RunHandle): AsyncIterable<RuntimeEvent>;
  /**
   * Ends the run and releases what it holds in the box. Emits any `usage` the
   * run had not reported yet, then closes the event stream. Safe to call twice.
   */
  endRun(run: RunHandle): Promise<void>;
}

/**
 * Why a runtime operation failed.
 *
 * - `invalid-input` — a prompt, model or session id the runtime will not send
 * - `unknown-run` — the handle is not from this runtime, or the run has ended
 * - `unknown-approval` — no approval request is waiting under that id
 * - `busy` — a turn is already running on this session
 * - `not-supported` — the agent does not offer what was asked of it
 * - `unavailable` — the agent process is gone, or never started
 * - `protocol` — the agent said something that cannot be made sense of
 */
export type RuntimeErrorKind =
  | "invalid-input"
  | "unknown-run"
  | "unknown-approval"
  | "busy"
  | "not-supported"
  | "unavailable"
  | "protocol";

/**
 * The error an `AgentRuntime` raises for its own failures. `detail` never
 * carries secret values. A `ComputerError` from the box passes through
 * unwrapped: the caller holds both ports and the box's own verdict is worth
 * more than a translation of it.
 */
export class RuntimeError extends Error {
  readonly kind: RuntimeErrorKind;

  constructor(kind: RuntimeErrorKind, detail?: string) {
    super(detail === undefined ? `runtime: ${kind}` : `runtime: ${kind}: ${detail}`);
    this.name = "RuntimeError";
    this.kind = kind;
  }
}
