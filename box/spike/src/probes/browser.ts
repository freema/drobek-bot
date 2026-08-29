/**
 * Spec point 4: browser = the host's Chrome over CDP, driven by Playwright MCP
 * running inside the box. Requires a Chrome with --remote-debugging-port=9222
 * on the host (see box/README.md).
 */
import { BOX_WORKDIR, hostAddressFromBox, writeFileInVolume } from "../docker.ts";
import { runSession } from "../run.ts";
import { playwrightMcpConfig } from "./browser-config.ts";
import { baseConfig, log, parseArgs } from "./common.ts";

const PROMPT =
  "Using the playwright MCP tools only: navigate to https://example.com, take a screenshot of the page, " +
  "then reply with the page title on one line. Do not use any other tool.";

const args = parseArgs("browser");

const versionResponse = await fetch("http://localhost:9222/json/version").catch(() => undefined);
if (versionResponse === undefined || !versionResponse.ok) {
  log(
    "no Chrome answering on http://localhost:9222/json/version; start one first (see box/README.md)",
  );
  process.exit(2);
}
log(`host Chrome: ${(await versionResponse.text()).replace(/\s+/g, " ").slice(0, 160)}`);

const hostIp = await hostAddressFromBox();
log(`host.docker.internal resolves to ${hostIp} inside the box; CDP endpoint uses the address`);
await writeFileInVolume(
  `${BOX_WORKDIR}/.mcp.json`,
  JSON.stringify(playwrightMcpConfig(hostIp), null, 2) + "\n",
);

const config = await baseConfig("browser", args, {
  prompts: [PROMPT],
  policy: { allow: ["mcp__playwright__*"] },
  timeoutMs: 300_000,
});
const summary = await runSession(config);

log(
  `stop=${summary.prompts.map((p) => p.stopReason ?? p.error).join(",")} cost=$${summary.costUsd.toFixed(5)} aborted=${summary.abortedBy}`,
);
for (const call of summary.toolCalls) {
  log(
    `  tool ${call.toolName ?? "?"} status=${call.status ?? "?"} permissionRequested=${call.permissionRequested}`,
  );
}
for (const image of summary.images) {
  log(`  image ${image.mimeType} ${image.bytes} bytes -> ${image.path}`);
}
log(`agent said: ${summary.prompts[0]?.agentText.trim() ?? ""}`);
process.exit(summary.images.length > 0 && summary.abortedBy === "none" ? 0 : 1);
