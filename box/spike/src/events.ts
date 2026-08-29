/**
 * Normalisation of ACP session updates into the NDJSON records the host
 * prints, one object per update. Pure: no I/O; images are returned separately
 * so the caller can persist them and the record stays small.
 */
import type {
  ContentBlock,
  PermissionOption,
  SessionNotification,
  StopReason,
  ToolCallContent,
  ToolKind,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";
import type { PermissionDecision } from "./policy.ts";
import type { TokenUsage } from "./pricing.ts";

export const MAX_TEXT_CHARS = 2000;

export type ContentSummary =
  | { type: "text"; text: string; truncatedFrom?: number }
  | { type: "image"; mimeType: string; bytes: number }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "other"; kind: string };

export type ExtractedImage = { toolCallId: string; mimeType: string; data: string };

export type EventRecord =
  | { t: number; type: "lifecycle"; phase: string; detail?: unknown }
  | { t: number; type: "agent_message"; text: string }
  | { t: number; type: "agent_thought"; text: string }
  | { t: number; type: "user_message"; text: string }
  | {
      t: number;
      type: "tool_call";
      toolCallId: string;
      toolName: string | undefined;
      kind: ToolKind | undefined;
      title: string;
      status: ToolCallStatus | undefined;
      rawInput: unknown;
    }
  | {
      t: number;
      type: "tool_call_update";
      toolCallId: string;
      toolName: string | undefined;
      status: ToolCallStatus | null | undefined;
      content: ContentSummary[] | undefined;
      rawOutput: unknown;
    }
  | { t: number; type: "session_update"; update: string; detail?: unknown }
  | {
      t: number;
      type: "permission_request";
      toolCallId: string;
      toolName: string | undefined;
      kind: ToolKind | undefined;
      title: string;
      rawInput: unknown;
      options: PermissionOption[];
      decision: PermissionDecision;
      optionId: string | undefined;
    }
  | { t: number; type: "prompt_result"; index: number; stopReason: StopReason; durationMs: number }
  | { t: number; type: "prompt_error"; index: number; message: string; durationMs: number }
  | {
      t: number;
      type: "usage";
      messageId: string;
      model: string;
      cliVersion: string | undefined;
      usage: TokenUsage;
      total: TokenUsage;
      totalCostUsd: number;
      capUsd: number;
    }
  | { t: number; type: "cap_exceeded"; totalCostUsd: number; capUsd: number }
  | { t: number; type: "memory"; phase: "idle" | "run"; bytes: number }
  | { t: number; type: "summary"; summary: unknown };

export function truncateText(
  text: string,
  max: number = MAX_TEXT_CHARS,
): {
  text: string;
  truncatedFrom?: number;
} {
  if (text.length <= max) return { text };
  return { text: text.slice(0, max), truncatedFrom: text.length };
}

/** Keeps small values as they are; replaces large ones with a bounded preview. */
export function preview(value: unknown, max: number = MAX_TEXT_CHARS): unknown {
  if (value === undefined) return undefined;
  let json: string;
  try {
    json = JSON.stringify(value) ?? "undefined";
  } catch {
    return { preview: "[unserialisable]" };
  }
  if (json.length <= max) return value;
  return { preview: json.slice(0, max), truncatedFrom: json.length };
}

function summariseBlock(block: ContentBlock): ContentSummary {
  switch (block.type) {
    case "text":
      return { type: "text", ...truncateText(block.text) };
    case "image":
      return {
        type: "image",
        mimeType: block.mimeType,
        bytes: Math.floor((block.data.length * 3) / 4),
      };
    default:
      return { type: "other", kind: block.type };
  }
}

export function summariseContent(content: readonly ToolCallContent[]): ContentSummary[] {
  return content.map((item) => {
    switch (item.type) {
      case "content":
        return summariseBlock(item.content);
      case "diff":
        return {
          type: "diff",
          path: item.path,
          oldText: item.oldText === null || item.oldText === undefined ? null : item.oldText,
          newText: item.newText,
        };
      default:
        return { type: "other", kind: item.type };
    }
  });
}

/** Pulls base64 images out of a tool call update so they can be written to disk. */
export function extractImages(notification: SessionNotification): ExtractedImage[] {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call_update" && update.sessionUpdate !== "tool_call") {
    return [];
  }
  const images: ExtractedImage[] = [];
  for (const item of update.content ?? []) {
    if (item.type === "content" && item.content.type === "image" && item.content.data !== "") {
      images.push({
        toolCallId: update.toolCallId,
        mimeType: item.content.mimeType,
        data: item.content.data,
      });
    }
  }
  return images;
}

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

export function normaliseUpdate(
  t: number,
  notification: SessionNotification,
  toolNames: ReadonlyMap<string, string>,
): EventRecord {
  const update = notification.update;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return { t, type: "agent_message", text: contentText(update.content) };
    case "agent_thought_chunk":
      return { t, type: "agent_thought", text: contentText(update.content) };
    case "user_message_chunk":
      return { t, type: "user_message", text: contentText(update.content) };
    case "tool_call":
      return {
        t,
        type: "tool_call",
        toolCallId: update.toolCallId,
        toolName: claudeToolName(update._meta) ?? toolNames.get(update.toolCallId),
        kind: update.kind,
        title: update.title,
        status: update.status,
        rawInput: preview(update.rawInput),
      };
    case "tool_call_update":
      return {
        t,
        type: "tool_call_update",
        toolCallId: update.toolCallId,
        toolName: claudeToolName(update._meta) ?? toolNames.get(update.toolCallId),
        status: update.status,
        content: update.content ? summariseContent(update.content) : undefined,
        rawOutput: preview(update.rawOutput),
      };
    default:
      return {
        t,
        type: "session_update",
        update: update.sessionUpdate,
        detail: preview(update, 600),
      };
  }
}

function contentText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  return `[${block.type}]`;
}
