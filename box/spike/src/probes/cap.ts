/**
 * Spec point 7: the host cap must fire. Default cap here is $0.001, far below
 * the cost of the first API call, so the run must be cancelled and killed by
 * the host before the turn ends.
 */
import { baseConfig, formatUsd, log, parseArgs } from "./common.ts";
import { runSession } from "../run.ts";

const PROMPT =
  "Use the Bash tool three times, one command per call: `ls /usr/lib`, `df -h`, `uname -a`. " +
  "After each result, say one sentence about it, then continue. Finally summarise.";

const args = parseArgs("cap", ["--cap", "0.001", ...process.argv.slice(2)]);
const config = await baseConfig("cap", args, {
  prompts: [PROMPT],
  policy: { allow: ["Bash"] },
  timeoutMs: 120_000,
});
const summary = await runSession(config);
log(
  `aborted by ${summary.abortedBy}; cost ${formatUsd(summary.costUsd)} vs cap ${formatUsd(summary.capUsd)}; stop=${summary.prompts.map((p) => p.stopReason ?? p.error).join(",")}; box exit=${summary.boxExitCode}`,
);
process.exit(summary.abortedBy === "host_cap" && summary.capExceeded ? 0 : 1);
