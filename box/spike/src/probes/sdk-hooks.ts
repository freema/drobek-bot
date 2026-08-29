/**
 * Spec point 3, fallback experiment: for actions that never raise an ACP
 * permission request, does the Claude Agent SDK's `canUseTool` see them, and
 * does a `PreToolUse` hook? Runs `box-scripts/can-use-tool.mjs` inside the box.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { BOX_WORKDIR, readApiKeyFromEnvFile, startBox, writeFileInVolume } from "../docker.ts";
import { redactSecrets } from "../redact.ts";
import { TEST_ENV_FILE, log } from "./common.ts";

const lineSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("canUseTool"), toolName: z.string(), input: z.unknown() }),
  z.object({ event: z.literal("PreToolUse"), toolName: z.string(), input: z.unknown() }),
  z.object({ event: z.literal("tool_use"), toolName: z.string(), input: z.unknown() }),
  z.object({
    event: z.literal("result"),
    subtype: z.string(),
    model: z.array(z.string()),
    total_cost_usd: z.number(),
    usage: z.unknown(),
    num_turns: z.number(),
  }),
]);

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "box-scripts",
  "can-use-tool.mjs",
);
const apiKey = await readApiKeyFromEnvFile(TEST_ENV_FILE);
if (apiKey === undefined) throw new Error(`No ANTHROPIC_API_KEY in ${TEST_ENV_FILE}`);

await writeFileInVolume(`${BOX_WORKDIR}/can-use-tool.mjs`, await readFile(scriptPath, "utf8"));
await writeFileInVolume(`${BOX_WORKDIR}/notes.txt`, "hello\n");

const box = startBox({
  name: `drobek-spike-sdk-hooks-${Date.now().toString(36)}`,
  env: { ANTHROPIC_API_KEY: apiKey },
  command: ["node", `${BOX_WORKDIR}/can-use-tool.mjs`],
});
box.process.stdin.end();
let stdout = "";
box.process.stdout.on("data", (chunk: Buffer) => {
  stdout += chunk.toString("utf8");
});
box.process.stderr.on("data", (chunk: Buffer) =>
  process.stderr.write(redactSecrets(chunk.toString("utf8"), apiKey).text),
);
const code = await box.exited;

const seen: Record<"canUseTool" | "PreToolUse" | "tool_use", string[]> = {
  canUseTool: [],
  PreToolUse: [],
  tool_use: [],
};
for (const raw of stdout.split("\n")) {
  const { text } = redactSecrets(raw, apiKey);
  if (text.trim() === "") continue;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    log(`unparsed: ${text}`);
    continue;
  }
  const parsed = lineSchema.safeParse(json);
  if (!parsed.success) {
    log(`unexpected: ${text}`);
    continue;
  }
  process.stdout.write(text + "\n");
  const line = parsed.data;
  if (line.event === "result") {
    log(
      `result ${line.subtype}: turns=${line.num_turns} model=${line.model.join(",")} cli total_cost_usd=${line.total_cost_usd}`,
    );
  } else {
    seen[line.event].push(line.toolName);
  }
}
log(`tool_use:   ${seen.tool_use.join(", ")}`);
log(`PreToolUse: ${seen.PreToolUse.join(", ")}`);
log(`canUseTool: ${seen.canUseTool.join(", ")}`);
log(`box exit code ${code}`);
process.exit(code === 0 ? 0 : 1);
