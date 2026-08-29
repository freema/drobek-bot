/**
 * ACP session updates normalised into `RuntimeEvent`s. Pure, apart from the
 * tool-call index the caller owns and passes in: ACP sends a tool's name once
 * and its later updates carry only what changed, so the name and the last
 * status have to be remembered somewhere for the events to stand on their own.
 *
 * Images are lifted out into `screenshot` events, so a `tool_call_update`
 * stays small enough to keep and to stream.
 */
import type { SessionNotification, ToolCallContent } from "@agentclientprotocol/sdk";
import type { RuntimeEvent } from "@drobek-bot/core";

/** What a tool call is called and where it got to, across its updates. */
export interface ToolCallInfo {
  toolName: string;
  title: string;
  status: string;
}

/** Keyed by ACP tool call id. Lives for one run. */
export type ToolCallIndex = Map<string, ToolCallInfo>;

/** ACP names a tool's kind, not the tool; the name is the adapter's `_meta`. */
const UNNAMED_TOOL = "unknown";

/** A tool call the agent has announced but not yet updated. */
const INITIAL_STATUS = "pending";

/** Tool name as Claude Code knows it, carried by the adapter in `_meta.claudeCode.toolName`. */
export function claudeToolName(meta: unknown): string | undefined {
  if (typeof meta !== "object" || meta === null || !("claudeCode" in meta)) return undefined;
  const claudeCode: unknown = meta.claudeCode;
  if (typeof claudeCode !== "object" || claudeCode === null || !("toolName" in claudeCode)) {
    return undefined;
  }
  const name: unknown = claudeCode.toolName;
  return typeof name === "string" ? name : undefined;
}

function screenshots(
  toolCallId: string,
  content: readonly ToolCallContent[] | null | undefined,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  for (const item of content ?? []) {
    if (item.type !== "content") continue;
    if (item.content.type !== "image" || item.content.data === "") continue;
    events.push({
      kind: "screenshot",
      toolCallId,
      mimeType: item.content.mimeType,
      data: item.content.data,
    });
  }
  return events;
}

/**
 * The events one session update turns into, and the index updated in place.
 *
 * Updates that carry nothing the contract has a shape for — plans, available
 * commands, mode changes, and the agent's own usage (which is empty; usage
 * comes from the transcript) — produce no events.
 */
export function toRuntimeEvents(
  notification: SessionNotification,
  index: ToolCallIndex,
): RuntimeEvent[] {
  const update = notification.update;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return update.content.type === "text"
        ? [{ kind: "text_delta", text: update.content.text }]
        : [];
    case "agent_thought_chunk":
      return update.content.type === "text"
        ? [{ kind: "thinking", text: update.content.text }]
        : [];
    case "tool_call": {
      const info: ToolCallInfo = {
        toolName: claudeToolName(update._meta) ?? UNNAMED_TOOL,
        title: update.title,
        status: update.status ?? INITIAL_STATUS,
      };
      index.set(update.toolCallId, info);
      return [
        ...screenshots(update.toolCallId, update.content),
        {
          kind: "tool_call",
          toolCallId: update.toolCallId,
          toolName: info.toolName,
          title: info.title,
          input: update.rawInput,
        },
      ];
    }
    case "tool_call_update": {
      const info = index.get(update.toolCallId);
      const name = claudeToolName(update._meta);
      if (info !== undefined) {
        if (name !== undefined) info.toolName = name;
        if (update.title !== undefined && update.title !== null) info.title = update.title;
        if (update.status !== undefined && update.status !== null) info.status = update.status;
      }
      const status = info?.status ?? update.status ?? INITIAL_STATUS;
      return [
        ...screenshots(update.toolCallId, update.content),
        {
          kind: "tool_call_update",
          toolCallId: update.toolCallId,
          status,
          ...(update.rawOutput === undefined ? {} : { output: update.rawOutput }),
        },
      ];
    }
    default:
      return [];
  }
}
