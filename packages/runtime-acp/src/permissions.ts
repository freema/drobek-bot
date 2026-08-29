/**
 * ACP `session/request_permission`, carried in both directions.
 *
 * READ THIS BEFORE YOU BUILD ANYTHING ON IT.
 *
 * This is a wire, not a gate. It turns the agent's question into an
 * `approval_request` event and turns a person's answer back into the option
 * the agent offered. It stops nothing. It cannot stop anything: by the time
 * one of these requests arrives, the agent's own permission engine has already
 * decided the action needed asking.
 *
 * What was measured in the box spike, with the unmodified `claude` CLI behind
 * the ACP adapter (`box/README.md`, "Permission requests by action"): two
 * whole classes of action never reach this path at all. Read-only shell
 * commands (`uname -a`, `find …`) and `Read` inside the working directory run
 * before `canUseTool` is consulted, and the client is never asked. A bot can
 * therefore read the box's filesystem and run read-only commands without a
 * single `approval_request` being emitted here, no matter what the person
 * would have answered.
 *
 * So: a fail-closed gate over *every* tool call cannot be built on this
 * module. It has to be a `PreToolUse` hook inside the box — the hook sees
 * every call and can return `permissionDecision: "deny"` — and it belongs to
 * the approvals work, not here. Nothing in this package is enforcement, and
 * nothing here should ever be described as a gate, a guard or a policy.
 *
 * Mistaking this transport for enforcement gives a bot an unattended shell.
 */
import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { ApprovalDecision, RuntimeEvent } from "@drobek-bot/core";

import { claudeToolName, type ToolCallIndex } from "./events.js";

/** An answer, and the option on the agent's side that expresses it. */
export interface SelectedOption {
  readonly optionId: string;
  /**
   * What the agent will actually apply. An "always" answer the agent did not
   * offer is narrowed to its one-shot sibling — never the other way round.
   */
  readonly decision: ApprovalDecision;
}

const NARROWER: Readonly<Record<ApprovalDecision, ApprovalDecision | undefined>> = {
  allow_once: undefined,
  allow_always: "allow_once",
  reject_once: undefined,
  reject_always: "reject_once",
};

/**
 * The option matching `decision`, or the narrower one when the agent offered
 * only that. Undefined when the agent offered neither, which is answered with
 * `cancelled` rather than with a decision nobody made.
 */
export function selectOption(
  decision: ApprovalDecision,
  options: readonly PermissionOption[],
): SelectedOption | undefined {
  const exact = options.find((option) => option.kind === decision);
  if (exact !== undefined) return { optionId: exact.optionId, decision };
  const narrower = NARROWER[decision];
  if (narrower === undefined) return undefined;
  const fallback = options.find((option) => option.kind === narrower);
  return fallback === undefined ? undefined : { optionId: fallback.optionId, decision: narrower };
}

/**
 * The event a permission request becomes. The tool's name and title come from
 * the `tool_call` update that preceded it, which is where the adapter puts
 * them; the request itself repeats only what changed.
 */
export function toApprovalRequest(
  approvalId: string,
  params: RequestPermissionRequest,
  index: ToolCallIndex,
): RuntimeEvent {
  const known = index.get(params.toolCall.toolCallId);
  return {
    kind: "approval_request",
    approvalId,
    toolCallId: params.toolCall.toolCallId,
    toolName: claudeToolName(params.toolCall._meta) ?? known?.toolName ?? "unknown",
    title: params.toolCall.title ?? known?.title ?? "",
    input: params.toolCall.rawInput,
  };
}
