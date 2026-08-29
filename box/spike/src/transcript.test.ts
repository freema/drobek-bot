import { describe, expect, it } from "vitest";
import { parseTranscriptLine, transcriptPath } from "./transcript.ts";

describe("parseTranscriptLine", () => {
  it("parses a valid assistant line into the model id and usage numbers", () => {
    const line = JSON.stringify({
      type: "assistant",
      version: "1.2.3",
      message: {
        id: "msg-1",
        model: "claude-haiku-4-5-20251001",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      },
    });
    expect(parseTranscriptLine(line)).toEqual({
      messageId: "msg-1",
      model: "claude-haiku-4-5-20251001",
      cliVersion: "1.2.3",
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5 },
    });
  });

  it("defaults missing cache token fields to zero and leaves cliVersion undefined", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        model: "claude-haiku-4-5",
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    });
    const parsed = parseTranscriptLine(line);
    expect(parsed?.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(parsed?.cliVersion).toBeUndefined();
  });

  it('defaults a missing model to "unknown" rather than dropping the line', () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", usage: { input_tokens: 1, output_tokens: 1 } },
    });
    expect(parseTranscriptLine(line)?.model).toBe("unknown");
  });

  it("skips a line whose message has no id, without throwing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { model: "claude-haiku-4-5", usage: { input_tokens: 1, output_tokens: 1 } },
    });
    expect(() => parseTranscriptLine(line)).not.toThrow();
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("skips a line whose message has no usage, without throwing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", model: "claude-haiku-4-5" },
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("skips a non-assistant record type", () => {
    for (const type of ["user", "summary", "system", "result"]) {
      const line = JSON.stringify({
        type,
        message: {
          id: "msg-1",
          model: "claude-haiku-4-5",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
      expect(parseTranscriptLine(line)).toBeNull();
    }
  });

  it("skips the synthetic model even when id and usage are present", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        model: "<synthetic>",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it("skips malformed JSON and blank lines, without throwing", () => {
    expect(() => parseTranscriptLine("{not json")).not.toThrow();
    expect(parseTranscriptLine("{not json")).toBeNull();
    expect(parseTranscriptLine("")).toBeNull();
    expect(parseTranscriptLine("   ")).toBeNull();
  });

  it("skips valid JSON that is not a matching assistant record, without throwing", () => {
    expect(parseTranscriptLine("42")).toBeNull();
    expect(parseTranscriptLine('"just a string"')).toBeNull();
    expect(parseTranscriptLine("[1,2,3]")).toBeNull();
    expect(parseTranscriptLine("null")).toBeNull();
  });

  it("skips usage with a negative token count, without throwing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-1",
        model: "claude-haiku-4-5",
        usage: { input_tokens: -1, output_tokens: 1 },
      },
    });
    expect(() => parseTranscriptLine(line)).not.toThrow();
    expect(parseTranscriptLine(line)).toBeNull();
  });
});

describe("transcriptPath", () => {
  it("encodes the cwd by replacing non-alphanumeric characters with hyphens", () => {
    expect(transcriptPath("/home/tomas", "/repo/box/spike", "session-1")).toBe(
      "/home/tomas/.claude/projects/-repo-box-spike/session-1.jsonl",
    );
  });
});
