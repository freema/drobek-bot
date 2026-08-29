/**
 * Spec point 6: the numbers. Runs the standard scenario once and prints image
 * size, cold start, memory, tokens and cost as a table on stderr (events still
 * go to stdout as NDJSON).
 */
import { imageSizeBytes, imageSizeHuman } from "../docker.ts";
import { runSession } from "../run.ts";
import { baseConfig, formatBytes, formatUsd, log, parseArgs } from "./common.ts";

const PROMPT =
  "Reply with exactly the word OK on the first line. Then use the Read tool on /etc/os-release " +
  "and reply with the PRETTY_NAME value on the second line. Nothing else.";

const args = parseArgs("measure");
const [sizeBytes, sizeHuman] = await Promise.all([imageSizeBytes(), imageSizeHuman()]);
const summary = await runSession(await baseConfig("measure", args, { prompts: [PROMPT] }));

const rows: [string, string][] = [
  ["image size (docker images)", sizeHuman],
  ["image size (inspect .Size)", formatBytes(sizeBytes)],
  ["docker run -> initialize response", `${summary.timings.dockerRunToInitializeMs ?? "?"} ms`],
  ["docker run -> session/new response", `${summary.timings.dockerRunToSessionMs ?? "?"} ms`],
  ["docker run -> first session/update", `${summary.timings.dockerRunToFirstUpdateMs ?? "?"} ms`],
  ["prompt -> first agent event", `${summary.prompts[0]?.firstAgentEventMs ?? "?"} ms`],
  ["prompt duration", `${summary.prompts[0]?.durationMs ?? "?"} ms`],
  ["memory idle", formatBytes(summary.memory.idleBytes)],
  ["memory peak during run", formatBytes(summary.memory.peakBytes)],
  ["input tokens", String(summary.usage.inputTokens)],
  ["output tokens", String(summary.usage.outputTokens)],
  ["cache read tokens", String(summary.usage.cacheReadTokens)],
  ["cache write tokens", String(summary.usage.cacheWriteTokens)],
  ["cost", formatUsd(summary.costUsd)],
  ["model observed", summary.model.observed.join(", ")],
  ["cli version", summary.cliVersions.join(", ")],
];
const width = Math.max(...rows.map(([k]) => k.length));
for (const [key, value] of rows) log(`${key.padEnd(width)}  ${value}`);
process.exit(summary.abortedBy === "none" ? 0 : 1);
