import { describe, expect, it } from "vitest";
import type { SessionNotification, ToolCallContent } from "@agentclientprotocol/sdk";
import {
  MAX_TEXT_CHARS,
  claudeToolName,
  extractImages,
  normaliseUpdate,
  preview,
  summariseContent,
  truncateText,
  type EventRecord,
} from "./events.ts";

const noToolNames: ReadonlyMap<string, string> = new Map();

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("hello", 10)).toEqual({ text: "hello" });
  });

  it("returns text at exactly the limit unchanged", () => {
    const text = "a".repeat(10);
    expect(truncateText(text, 10)).toEqual({ text });
  });

  it("truncates text over the limit and records the original length", () => {
    const text = "a".repeat(15);
    expect(truncateText(text, 10)).toEqual({ text: "a".repeat(10), truncatedFrom: 15 });
  });

  it("defaults to MAX_TEXT_CHARS when no limit is given", () => {
    const text = "a".repeat(MAX_TEXT_CHARS + 1);
    const result = truncateText(text);
    expect(result.text).toHaveLength(MAX_TEXT_CHARS);
    expect(result.truncatedFrom).toBe(MAX_TEXT_CHARS + 1);
  });
});

describe("preview", () => {
  it("passes undefined through unchanged", () => {
    expect(preview(undefined)).toBeUndefined();
  });

  it("keeps small values as-is", () => {
    const value = { command: "ls", cwd: "/tmp" };
    expect(preview(value, 100)).toEqual(value);
  });

  it("replaces a large value with a bounded preview of its JSON", () => {
    const value = { text: "a".repeat(50) };
    const json = JSON.stringify(value);
    const result = preview(value, 10);
    expect(result).toEqual({ preview: json.slice(0, 10), truncatedFrom: json.length });
  });

  it("falls back to a marker for a value JSON.stringify cannot serialise", () => {
    const unserialisable = 10n;
    expect(preview(unserialisable, 100)).toEqual({ preview: "[unserialisable]" });
  });
});

describe("summariseContent", () => {
  it("summarises a short text content item", () => {
    const items: ToolCallContent[] = [{ type: "content", content: { type: "text", text: "hi" } }];
    expect(summariseContent(items)).toEqual([{ type: "text", text: "hi" }]);
  });

  it("truncates a long text content item", () => {
    const longText = "a".repeat(MAX_TEXT_CHARS + 10);
    const items: ToolCallContent[] = [
      { type: "content", content: { type: "text", text: longText } },
    ];
    expect(summariseContent(items)).toEqual([
      { type: "text", text: longText.slice(0, MAX_TEXT_CHARS), truncatedFrom: longText.length },
    ]);
  });

  it("summarises an image content item by its decoded byte size", () => {
    // base64 "AAAA" decodes to exactly 3 bytes.
    const items: ToolCallContent[] = [
      { type: "content", content: { type: "image", data: "AAAA", mimeType: "image/png" } },
    ];
    expect(summariseContent(items)).toEqual([{ type: "image", mimeType: "image/png", bytes: 3 }]);
  });

  it("summarises a diff item, mapping a missing oldText to null", () => {
    const items: ToolCallContent[] = [
      { type: "diff", path: "/a.ts", newText: "new" },
      { type: "diff", path: "/b.ts", oldText: "old", newText: "new" },
    ];
    expect(summariseContent(items)).toEqual([
      { type: "diff", path: "/a.ts", oldText: null, newText: "new" },
      { type: "diff", path: "/b.ts", oldText: "old", newText: "new" },
    ]);
  });

  it('summarises a terminal item and other content kinds as "other"', () => {
    const items: ToolCallContent[] = [
      { type: "terminal", terminalId: "term-1" },
      { type: "content", content: { type: "audio", data: "", mimeType: "audio/wav" } },
    ];
    expect(summariseContent(items)).toEqual([
      { type: "other", kind: "terminal" },
      { type: "other", kind: "audio" },
    ]);
  });
});

describe("extractImages", () => {
  function notification(update: SessionNotification["update"]): SessionNotification {
    return { sessionId: "sess-1", update };
  }

  it("extracts an image from a tool_call_update", () => {
    const n = notification({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      content: [
        { type: "content", content: { type: "image", data: "AAAA", mimeType: "image/png" } },
      ],
    });
    expect(extractImages(n)).toEqual([
      { toolCallId: "call-1", mimeType: "image/png", data: "AAAA" },
    ]);
  });

  it("extracts an image from a tool_call", () => {
    const n = notification({
      sessionUpdate: "tool_call",
      toolCallId: "call-2",
      title: "screenshot",
      content: [
        { type: "content", content: { type: "image", data: "BBBB", mimeType: "image/jpeg" } },
      ],
    });
    expect(extractImages(n)).toEqual([
      { toolCallId: "call-2", mimeType: "image/jpeg", data: "BBBB" },
    ]);
  });

  it("skips images with empty data", () => {
    const n = notification({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      content: [{ type: "content", content: { type: "image", data: "", mimeType: "image/png" } }],
    });
    expect(extractImages(n)).toEqual([]);
  });

  it("ignores non-image content and returns only images, in order", () => {
    const n = notification({
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      content: [
        { type: "content", content: { type: "text", text: "hi" } },
        { type: "content", content: { type: "image", data: "CCCC", mimeType: "image/png" } },
        { type: "diff", path: "/a.ts", newText: "x" },
      ],
    });
    expect(extractImages(n)).toEqual([
      { toolCallId: "call-1", mimeType: "image/png", data: "CCCC" },
    ]);
  });

  it("returns an empty array when content is absent", () => {
    const n = notification({ sessionUpdate: "tool_call_update", toolCallId: "call-1" });
    expect(extractImages(n)).toEqual([]);
  });

  it("returns an empty array for update kinds other than tool_call/tool_call_update", () => {
    const n = notification({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    expect(extractImages(n)).toEqual([]);
  });
});

describe("claudeToolName", () => {
  it("returns undefined when there is no meta", () => {
    expect(claudeToolName(undefined)).toBeUndefined();
    expect(claudeToolName(null)).toBeUndefined();
  });

  it("returns undefined when meta is not an object", () => {
    expect(claudeToolName("not an object")).toBeUndefined();
    expect(claudeToolName(42)).toBeUndefined();
  });

  it("returns undefined when claudeCode is missing", () => {
    expect(claudeToolName({ somethingElse: true })).toBeUndefined();
  });

  it("returns undefined when claudeCode has no toolName", () => {
    expect(claudeToolName({ claudeCode: {} })).toBeUndefined();
  });

  it("returns undefined when toolName is not a string", () => {
    expect(claudeToolName({ claudeCode: { toolName: 123 } })).toBeUndefined();
  });

  it("returns the tool name Claude Code attached", () => {
    expect(claudeToolName({ claudeCode: { toolName: "Bash" } })).toBe("Bash");
  });
});

describe("normaliseUpdate", () => {
  it("normalises an agent message chunk", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toEqual({
      t: 1000,
      type: "agent_message",
      text: "hi",
    });
  });

  it("normalises an agent thought chunk", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toEqual({
      t: 1000,
      type: "agent_thought",
      text: "thinking",
    });
  });

  it("normalises a user message chunk, substituting a placeholder for non-text content", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "image", data: "AAAA", mimeType: "image/png" },
      },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toEqual({
      t: 1000,
      type: "user_message",
      text: "[image]",
    });
  });

  it("resolves the tool name from _meta.claudeCode.toolName over the toolNames map", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "run ls",
        kind: "execute",
        status: "pending",
        rawInput: { command: "ls" },
        _meta: { claudeCode: { toolName: "Bash" } },
      },
    };
    const toolNames = new Map([["call-1", "OtherName"]]);
    expect(normaliseUpdate(1000, n, toolNames)).toEqual({
      t: 1000,
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "Bash",
      kind: "execute",
      title: "run ls",
      status: "pending",
      rawInput: { command: "ls" },
    });
  });

  it("falls back to the toolNames map when there is no _meta", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", toolCallId: "call-1", title: "run ls" },
    };
    const toolNames = new Map([["call-1", "Bash"]]);
    expect(normaliseUpdate(1000, n, toolNames)).toMatchObject({ toolName: "Bash" });
  });

  it("leaves toolName undefined when it is known nowhere", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call", toolCallId: "call-1", title: "mystery" },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toMatchObject({ toolName: undefined });
  });

  it("normalises a tool_call_update, summarising content when present", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "done" } }],
        rawOutput: { ok: true },
      },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toEqual({
      t: 1000,
      type: "tool_call_update",
      toolCallId: "call-1",
      toolName: undefined,
      status: "completed",
      content: [{ type: "text", text: "done" }],
      rawOutput: { ok: true },
    });
  });

  it("leaves content undefined on a tool_call_update with no content", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "tool_call_update", toolCallId: "call-1" },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toMatchObject({ content: undefined });
  });

  it("does not throw on an update kind it does not special-case, and passes it through as session_update", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "current_mode_update", currentModeId: "default" },
    };
    let record: EventRecord | undefined;
    expect(() => {
      record = normaliseUpdate(1000, n, noToolNames);
    }).not.toThrow();
    expect(record).toMatchObject({
      t: 1000,
      type: "session_update",
      update: "current_mode_update",
    });
  });

  it("handles every other unknown update kind the same consistent way", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "plan_removed", planId: "plan-1" },
    };
    expect(normaliseUpdate(1000, n, noToolNames)).toMatchObject({
      t: 1000,
      type: "session_update",
      update: "plan_removed",
    });
  });

  it("every produced record carries a numeric t and a string type", () => {
    const n: SessionNotification = {
      sessionId: "s1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } },
    };
    const record = normaliseUpdate(42, n, noToolNames);
    expect(typeof record.t).toBe("number");
    expect(typeof record.type).toBe("string");
  });
});

describe("EventRecord JSON round-trip", () => {
  type PermissionRequestRecord = Extract<EventRecord, { type: "permission_request" }>;

  function permissionRequestRecord(): PermissionRequestRecord {
    return {
      t: 10,
      type: "permission_request",
      toolCallId: "c1",
      toolName: "Bash",
      kind: "execute",
      title: "run rm",
      rawInput: { command: "rm -rf /" },
      options: [{ optionId: "a", name: "Allow once", kind: "allow_once" }],
      decision: "deny",
      optionId: undefined,
    };
  }

  it("a permission_request record carries the tool name and the model's raw input", () => {
    const record = permissionRequestRecord();
    expect(record.toolName).toBe("Bash");
    expect(record.rawInput).toEqual({ command: "rm -rf /" });
  });

  it("round-trips a representative record of each shape losslessly through JSON", () => {
    const records: EventRecord[] = [
      { t: 1, type: "agent_message", text: "hi" },
      {
        t: 2,
        type: "tool_call",
        toolCallId: "c1",
        toolName: "Bash",
        kind: "execute",
        title: "ls",
        status: "pending",
        rawInput: { cmd: "ls" },
      },
      permissionRequestRecord(),
      {
        t: 4,
        type: "usage",
        messageId: "m1",
        model: "claude-haiku-4-5",
        cliVersion: "1.0.0",
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
        total: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
        totalCostUsd: 0.001,
        capUsd: 1,
      },
      { t: 5, type: "cap_exceeded", totalCostUsd: 2, capUsd: 1 },
    ];
    for (const record of records) {
      const roundTripped: unknown = JSON.parse(JSON.stringify(record));
      expect(roundTripped).toEqual(record);
    }
  });
});
