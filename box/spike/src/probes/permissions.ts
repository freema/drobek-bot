/**
 * Spec point 3: which risky actions surface as `session/request_permission`.
 * One session, one prompt per action so a denied action cannot mask the next
 * one; `--decision deny|allow` selects the policy for the whole run.
 */
import { BOX_WORKDIR, hostAddressFromBox, writeFileInVolume } from "../docker.ts";
import { ALLOW_ALL, DENY_ALL } from "../policy.ts";
import { runSession } from "../run.ts";
import { playwrightMcpConfig } from "./browser-config.ts";
import { baseConfig, log, parseArgs } from "./common.ts";

const ACTIONS: readonly { label: string; prompt: string }[] = [
  {
    label: "shell, read-only (Bash uname -a)",
    prompt: "Run the shell command `uname -a` with the Bash tool and reply with its output only.",
  },
  {
    label: "shell, side effect (Bash writes a file)",
    prompt:
      "Run exactly this shell command with the Bash tool: `mkdir -p created-by-shell && echo created > created-by-shell/marker.txt && cat created-by-shell/marker.txt`. Reply with its output only.",
  },
  {
    label: "shell, network (Bash curl)",
    prompt:
      "Run exactly this shell command with the Bash tool: `curl -sS https://example.com | head -c 120`. Reply with its output only.",
  },
  {
    label: "file write, new file (Write)",
    prompt:
      "Use the Write tool to create a new file greeting.txt in the current directory with the single line `hello`. Reply DONE when finished.",
  },
  {
    label: "file edit (Edit)",
    prompt:
      "Read notes.txt in the current directory with the Read tool, then use the Edit tool on it: replace `hello` with `hello world`. Reply DONE when finished.",
  },
  {
    label: "MCP tool call (Playwright browser_navigate)",
    prompt:
      "Use the playwright MCP tool browser_navigate to open https://example.com. Reply DONE when finished.",
  },
];

const args = parseArgs("permissions");
const decisionArg = args.rest.includes("--decision")
  ? args.rest[args.rest.indexOf("--decision") + 1]
  : "deny";
if (decisionArg !== "deny" && decisionArg !== "allow") throw new Error("--decision deny|allow");

// The Edit step needs a file to edit even when Write was denied, and the MCP
// step needs the Playwright server configured the way Claude Code reads it.
await writeFileInVolume(`${BOX_WORKDIR}/notes.txt`, "hello\n");
const hostIp = await hostAddressFromBox();
log(`host.docker.internal resolves to ${hostIp} inside the box; CDP endpoint uses the address`);
await writeFileInVolume(
  `${BOX_WORKDIR}/.mcp.json`,
  JSON.stringify(playwrightMcpConfig(hostIp), null, 2) + "\n",
);

const config = await baseConfig(`permissions-${decisionArg}`, args, {
  prompts: ACTIONS.map((a) => a.prompt),
  policy: decisionArg === "allow" ? ALLOW_ALL : DENY_ALL,
  maxTurns: 4,
});
const summary = await runSession(config);

log(`decision policy: ${decisionArg}`);
for (const [index, action] of ACTIONS.entries()) {
  const outcome = summary.prompts[index];
  log(`${action.label}: prompt stop=${outcome?.stopReason ?? outcome?.error ?? "not run"}`);
}
log("tool calls:");
for (const call of summary.toolCalls) {
  log(
    `  ${call.toolName ?? "?"} kind=${call.kind ?? "?"} status=${call.status ?? "?"} permissionRequested=${call.permissionRequested} title=${call.title}`,
  );
}
log("permission requests:");
for (const request of summary.permissionRequests) {
  log(
    `  ${request.toolName ?? "?"} kind=${request.kind ?? "?"} decision=${request.decision} option=${request.optionId ?? "none"} final=${request.finalStatus ?? "?"} input=${JSON.stringify(request.rawInput)}`,
  );
}
log(`cost ${summary.costUsd.toFixed(5)} aborted=${summary.abortedBy}`);
process.exit(summary.abortedBy === "none" ? 0 : 1);
