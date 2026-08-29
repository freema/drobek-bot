/**
 * One spike run: start a box, drive it over ACP, stream events as NDJSON,
 * account usage from the transcript, enforce the cost cap, stop the box.
 * All policy/accounting/normalisation decisions are delegated to the pure
 * modules; this file is plumbing.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
  type ToolCallStatus,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import { z } from "zod";
import { connectAcp } from "./acp-client.ts";
import {
  BOX_HOME,
  BOX_WORKDIR,
  execInBox,
  killBox,
  memoryBytes,
  startBox,
  tailFileInBox,
  writeFileInVolume,
} from "./docker.ts";
import { claudeToolName, extractImages, normaliseUpdate, type EventRecord } from "./events.ts";
import { decide, selectOption, type PermissionDecision, type Policy } from "./policy.ts";
import {
  checkCap,
  emptyLedger,
  ledgerModels,
  ledgerTotals,
  recordUsage,
  type TokenUsage,
  type UsageLedger,
} from "./pricing.ts";
import { redactSecrets } from "./redact.ts";
import { parseTranscriptLine, transcriptPath } from "./transcript.ts";

export const DEFAULT_MODEL = "claude-haiku-4-5";
export const DEFAULT_CAP_USD = 0.05;
export const DEFAULT_MAX_TURNS = 12;

export type RunConfig = {
  /** Label; also the container name suffix. */
  name: string;
  prompts: readonly string[];
  policy: Policy;
  capUsd: number;
  maxTurns: number;
  model: string;
  /**
   * How the model is requested; the transcript shows which one took effect.
   * `option`: `_meta.claudeCode.options.model` on session/new. `env`:
   * ANTHROPIC_MODEL in the box. `settings`: `"model"` in the project's
   * `.claude/settings.json`, written into the volume before the run.
   */
  modelVia: ModelVia;
  /** Missing key means the box relies on whatever `claude` finds in its home (subscription login). */
  apiKey: string | undefined;
  outDir: string;
  /** Continue an existing session via `session/load` instead of `session/new`. */
  resumeSessionId?: string;
  /** Claude Code's own budget stop, off by default so the host cap is what fires. */
  cliBudgetUsd?: number;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
};

export type ModelVia = "option" | "env" | "settings";

export type AbortReason = "none" | "host_cap" | "timeout" | "box_exited";

export type PromptOutcome = {
  index: number;
  stopReason?: StopReason;
  error?: string;
  durationMs: number;
  firstAgentEventMs: number | undefined;
  agentText: string;
};

export type PermissionLogEntry = {
  toolCallId: string;
  toolName: string | undefined;
  kind: ToolKind | undefined;
  title: string;
  rawInput: unknown;
  decision: PermissionDecision;
  optionId: string | undefined;
  /** Status the tool call ended with after the decision, when observed. */
  finalStatus: ToolCallStatus | null | undefined;
};

export type ToolCallLogEntry = {
  toolCallId: string;
  toolName: string | undefined;
  kind: ToolKind | undefined;
  title: string;
  status: ToolCallStatus | null | undefined;
  permissionRequested: boolean;
};

export type SavedImage = { toolCallId: string; mimeType: string; bytes: number; path: string };

export type RunSummary = {
  run: string;
  containerName: string;
  sessionId: string | undefined;
  resumed: boolean;
  model: { requested: string; via: ModelVia; observed: string[] };
  cliVersions: string[];
  timings: {
    dockerRunToInitializeMs: number | undefined;
    dockerRunToSessionMs: number | undefined;
    dockerRunToFirstUpdateMs: number | undefined;
    totalMs: number;
  };
  memory: { idleBytes: number | undefined; peakBytes: number | undefined };
  usage: TokenUsage;
  costUsd: number;
  capUsd: number;
  capExceeded: boolean;
  abortedBy: AbortReason;
  prompts: PromptOutcome[];
  toolCalls: ToolCallLogEntry[];
  permissionRequests: PermissionLogEntry[];
  images: SavedImage[];
  usageUpdatesFromAcp: number;
  redactionsHit: number;
  initialize: unknown;
  session: unknown;
  boxExitCode: number | null;
};

const sessionExtrasSchema = z.object({
  models: z
    .object({
      currentModelId: z.string(),
      availableModels: z.array(z.object({ modelId: z.string(), name: z.string() })),
    })
    .optional(),
  modes: z.object({ currentModeId: z.string() }).optional(),
});

function sameUsage(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens
  );
}

export async function runSession(config: RunConfig): Promise<RunSummary> {
  const containerName = `drobek-spike-${config.name}-${Date.now().toString(36)}`;
  await mkdir(config.outDir, { recursive: true });
  const eventsFile = createWriteStream(path.join(config.outDir, "events.ndjson"));
  const stderrFile = createWriteStream(path.join(config.outDir, "box-stderr.log"));

  let redactionsHit = 0;
  const writeLine = (file: WriteStream, text: string): void => {
    const { text: safe, redacted } = redactSecrets(text, config.apiKey);
    if (redacted) redactionsHit += 1;
    file.write(safe + "\n");
  };

  const env: Record<string, string> = { ...config.extraEnv };
  if (config.apiKey !== undefined) env.ANTHROPIC_API_KEY = config.apiKey;
  if (config.modelVia === "env") env.ANTHROPIC_MODEL = config.model;
  if (config.modelVia === "settings") {
    await writeFileInVolume(
      `${BOX_WORKDIR}/.claude/settings.json`,
      JSON.stringify({ model: config.model }, null, 2) + "\n",
    );
  }

  const box = startBox({ name: containerName, env });
  const t0 = box.startedAt;
  const elapsed = (): number => Date.now() - t0;
  const emit = (record: EventRecord): void => {
    const line = JSON.stringify(record);
    const { text: safe, redacted } = redactSecrets(line, config.apiKey);
    if (redacted) redactionsHit += 1;
    process.stdout.write(safe + "\n");
    eventsFile.write(safe + "\n");
  };
  box.process.stderr.on("data", (chunk: Buffer) =>
    writeLine(stderrFile, chunk.toString("utf8").trimEnd()),
  );
  emit({ t: 0, type: "lifecycle", phase: "docker_run", detail: { containerName } });

  let abortedBy: AbortReason = "none";
  let sessionId: string | undefined;
  let ledger: UsageLedger = emptyLedger();
  const preexistingMessages = new Set<string>();
  const cliVersions = new Set<string>();
  const toolNames = new Map<string, string>();
  const toolCalls = new Map<string, ToolCallLogEntry>();
  const permissionLog: PermissionLogEntry[] = [];
  const images: SavedImage[] = [];
  const prompts: PromptOutcome[] = [];
  let usageUpdatesFromAcp = 0;
  let firstUpdateMs: number | undefined;
  let current: PromptOutcome | undefined;
  let promptStartedAt = 0;

  const abort = (reason: AbortReason): void => {
    if (abortedBy !== "none") return;
    abortedBy = reason;
    emit({ t: elapsed(), type: "lifecycle", phase: "abort", detail: { reason } });
    if (sessionId !== undefined) {
      connection.cancel({ sessionId }).catch(() => undefined);
    }
    void sleep(3000).then(() => killBox(containerName));
  };

  const handleTranscriptLine = (line: string): void => {
    const record = parseTranscriptLine(line);
    if (record === null || preexistingMessages.has(record.messageId)) return;
    const previous = ledger.byMessage.get(record.messageId);
    if (previous !== undefined && sameUsage(previous.usage, record.usage)) return;
    if (record.cliVersion !== undefined) cliVersions.add(record.cliVersion);
    ledger = recordUsage(ledger, record);
    const total = ledgerTotals(ledger);
    const cap = checkCap(ledger, config.capUsd);
    emit({
      t: elapsed(),
      type: "usage",
      messageId: record.messageId,
      model: record.model,
      cliVersion: record.cliVersion,
      usage: record.usage,
      total,
      totalCostUsd: cap.costUsd,
      capUsd: config.capUsd,
    });
    if (cap.exceeded && abortedBy === "none") {
      emit({ t: elapsed(), type: "cap_exceeded", totalCostUsd: cap.costUsd, capUsd: cap.capUsd });
      abort("host_cap");
    }
  };

  const sessionUpdate = async (notification: SessionNotification): Promise<void> => {
    const t = elapsed();
    firstUpdateMs ??= t;
    const update = notification.update;
    if (update.sessionUpdate === "tool_call") {
      const toolName = claudeToolName(update._meta);
      if (toolName !== undefined) toolNames.set(update.toolCallId, toolName);
      toolCalls.set(update.toolCallId, {
        toolCallId: update.toolCallId,
        toolName,
        kind: update.kind,
        title: update.title,
        status: update.status,
        permissionRequested: false,
      });
    } else if (update.sessionUpdate === "tool_call_update") {
      const entry = toolCalls.get(update.toolCallId);
      if (entry !== undefined && update.status !== undefined && update.status !== null) {
        entry.status = update.status;
        const permission = permissionLog.find((p) => p.toolCallId === update.toolCallId);
        if (permission !== undefined) permission.finalStatus = update.status;
      }
    } else if (update.sessionUpdate === "usage_update") {
      usageUpdatesFromAcp += 1;
    }
    if (
      current !== undefined &&
      current.firstAgentEventMs === undefined &&
      (update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk" ||
        update.sessionUpdate === "tool_call")
    ) {
      current.firstAgentEventMs = Date.now() - promptStartedAt;
    }
    if (
      current !== undefined &&
      update.sessionUpdate === "agent_message_chunk" &&
      update.content.type === "text"
    ) {
      current.agentText += update.content.text;
    }
    for (const [i, image] of extractImages(notification).entries()) {
      const ext = image.mimeType.split("/")[1] ?? "bin";
      const file = path.join(config.outDir, `${image.toolCallId}-${i}.${ext}`);
      const bytes = Buffer.from(image.data, "base64");
      await writeFile(file, bytes);
      images.push({
        toolCallId: image.toolCallId,
        mimeType: image.mimeType,
        bytes: bytes.length,
        path: file,
      });
      emit({
        t,
        type: "lifecycle",
        phase: "image_saved",
        detail: { path: file, bytes: bytes.length },
      });
    }
    emit(normaliseUpdate(t, notification, toolNames));
  };

  const requestPermission = (
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> => {
    const t = elapsed();
    const known = toolCalls.get(params.toolCall.toolCallId);
    if (known !== undefined) known.permissionRequested = true;
    const view = {
      toolCallId: params.toolCall.toolCallId,
      toolName: known?.toolName,
      kind: known?.kind ?? params.toolCall.kind ?? undefined,
      title: params.toolCall.title ?? known?.title ?? "",
      rawInput: params.toolCall.rawInput,
    };
    const decision = decide(view, config.policy);
    const optionId = selectOption(decision, params.options);
    permissionLog.push({ ...view, decision, optionId, finalStatus: undefined });
    emit({ t, type: "permission_request", ...view, options: params.options, decision, optionId });
    if (optionId === undefined) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    return Promise.resolve({ outcome: { outcome: "selected", optionId } });
  };

  const connection = connectAcp(box.process.stdin, box.process.stdout, {
    sessionUpdate,
    requestPermission,
  });
  const boxGone = box.exited.then((code) => {
    emit({ t: elapsed(), type: "lifecycle", phase: "box_exited", detail: { code } });
    return code;
  });
  const failWhenBoxGone = boxGone.then(() => {
    throw new Error("box exited");
  });
  const timeout = setTimeout(() => abort("timeout"), config.timeoutMs ?? 240_000);

  let initialize: unknown;
  let session: unknown;
  let idleBytes: number | undefined;
  let peakBytes: number | undefined;
  let tail: { stop: () => void } | undefined;
  const timings: RunSummary["timings"] = {
    dockerRunToInitializeMs: undefined,
    dockerRunToSessionMs: undefined,
    dockerRunToFirstUpdateMs: undefined,
    totalMs: 0,
  };

  try {
    const initResponse = await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "drobek-bot-box-spike", version: "0.0.0" },
      }),
      failWhenBoxGone,
    ]);
    timings.dockerRunToInitializeMs = elapsed();
    initialize = initResponse;
    emit({ t: elapsed(), type: "lifecycle", phase: "initialize", detail: initResponse });

    const meta = {
      claudeCode: {
        options: {
          ...(config.modelVia === "option" ? { model: config.model } : {}),
          maxTurns: config.maxTurns,
          ...(config.cliBudgetUsd !== undefined ? { maxBudgetUsd: config.cliBudgetUsd } : {}),
        },
      },
    };
    const transcript = (id: string): string => transcriptPath(BOX_HOME, BOX_WORKDIR, id);
    if (config.resumeSessionId !== undefined) {
      sessionId = config.resumeSessionId;
      const existing = await execInBox(containerName, ["cat", transcript(sessionId)]).catch(
        () => "",
      );
      for (const line of existing.split("\n")) {
        const record = parseTranscriptLine(line);
        if (record !== null) preexistingMessages.add(record.messageId);
      }
      emit({ t: elapsed(), type: "lifecycle", phase: "session_load_start", detail: { sessionId } });
      const loadResponse = await Promise.race([
        connection.loadSession({ sessionId, cwd: BOX_WORKDIR, mcpServers: [], _meta: meta }),
        failWhenBoxGone,
      ]);
      session = loadResponse;
      emit({ t: elapsed(), type: "lifecycle", phase: "session_loaded", detail: loadResponse });
    } else {
      const newResponse = await Promise.race([
        connection.newSession({ cwd: BOX_WORKDIR, mcpServers: [], _meta: meta }),
        failWhenBoxGone,
      ]);
      sessionId = newResponse.sessionId;
      const extras = sessionExtrasSchema.safeParse(JSON.parse(JSON.stringify(newResponse)));
      session = extras.success ? { sessionId, ...extras.data } : { sessionId };
      emit({ t: elapsed(), type: "lifecycle", phase: "session_new", detail: session });
    }
    timings.dockerRunToSessionMs = elapsed();
    tail = tailFileInBox(containerName, transcript(sessionId), handleTranscriptLine);

    idleBytes = await memoryBytes(containerName);
    if (idleBytes !== undefined)
      emit({ t: elapsed(), type: "memory", phase: "idle", bytes: idleBytes });

    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const bytes = await memoryBytes(containerName);
        if (bytes !== undefined) {
          if (peakBytes === undefined || bytes > peakBytes) peakBytes = bytes;
          emit({ t: elapsed(), type: "memory", phase: "run", bytes });
        }
        await sleep(1000);
      }
    })();

    for (const [index, text] of config.prompts.entries()) {
      if (abortedBy !== "none") break;
      promptStartedAt = Date.now();
      current = { index, durationMs: 0, firstAgentEventMs: undefined, agentText: "" };
      emit({ t: elapsed(), type: "lifecycle", phase: "prompt", detail: { index, text } });
      try {
        const response = await Promise.race([
          connection.prompt({ sessionId, prompt: [{ type: "text", text }] }),
          failWhenBoxGone,
        ]);
        current.stopReason = response.stopReason;
        if (response.usage !== undefined && response.usage !== null) usageUpdatesFromAcp += 1;
        current.durationMs = Date.now() - promptStartedAt;
        emit({
          t: elapsed(),
          type: "prompt_result",
          index,
          stopReason: response.stopReason,
          durationMs: current.durationMs,
        });
      } catch (error) {
        current.error = error instanceof Error ? error.message : String(error);
        current.durationMs = Date.now() - promptStartedAt;
        emit({
          t: elapsed(),
          type: "prompt_error",
          index,
          message: current.error,
          durationMs: current.durationMs,
        });
      }
      prompts.push(current);
      current = undefined;
    }
    sampling = false;
    await sampler;

    // Let the tail catch up, then reconcile against the whole transcript once.
    await sleep(800);
    const finalText = await execInBox(containerName, ["cat", transcript(sessionId)]).catch(
      () => "",
    );
    for (const line of finalText.split("\n")) {
      const record = parseTranscriptLine(line);
      if (record === null || preexistingMessages.has(record.messageId)) continue;
      if (!ledger.byMessage.has(record.messageId)) handleTranscriptLine(line);
    }
  } catch (error) {
    if (abortedBy === "none") abortedBy = "box_exited";
    emit({
      t: elapsed(),
      type: "lifecycle",
      phase: "run_error",
      detail: { message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    clearTimeout(timeout);
    tail?.stop();
    emit({ t: elapsed(), type: "lifecycle", phase: "stop_box" });
    await killBox(containerName);
  }
  const boxExitCode = await boxGone;

  const usage = ledgerTotals(ledger);
  const cap = checkCap(ledger, config.capUsd);
  timings.dockerRunToFirstUpdateMs = firstUpdateMs;
  timings.totalMs = elapsed();
  const summary: RunSummary = {
    run: config.name,
    containerName,
    sessionId,
    resumed: config.resumeSessionId !== undefined,
    model: { requested: config.model, via: config.modelVia, observed: ledgerModels(ledger) },
    cliVersions: [...cliVersions].sort(),
    timings,
    memory: { idleBytes, peakBytes },
    usage,
    costUsd: cap.costUsd,
    capUsd: config.capUsd,
    capExceeded: cap.exceeded,
    abortedBy,
    prompts,
    toolCalls: [...toolCalls.values()],
    permissionRequests: permissionLog,
    images,
    usageUpdatesFromAcp,
    redactionsHit,
    initialize,
    session,
    boxExitCode,
  };
  emit({ t: elapsed(), type: "summary", summary });
  await writeFile(path.join(config.outDir, "summary.json"), JSON.stringify(summary, null, 2));
  eventsFile.end();
  stderrFile.end();
  return summary;
}
