/**
 * Spec points 1, 2, 6 and 7: events out of the box, API-key auth, numbers,
 * model pin and cap. One session, one prompt that produces text and a Read.
 */
import { baseConfig, formatBytes, formatUsd, log, parseArgs } from "./common.ts";
import { runSession } from "../run.ts";

const PROMPT =
  "Reply with exactly the word OK on the first line. Then use the Read tool on /etc/os-release " +
  "and reply with the PRETTY_NAME value on the second line. Nothing else.";

const args = parseArgs("acp");
const config = await baseConfig("acp", args, { prompts: [PROMPT] });
const summary = await runSession(config);
log(
  `session ${summary.sessionId ?? "none"}; stop=${summary.prompts.map((p) => p.stopReason ?? p.error).join(",")}`,
);
log(
  `model requested=${summary.model.requested} via=${summary.model.via} observed=${summary.model.observed.join(",")}`,
);
log(`cli versions=${summary.cliVersions.join(",")}`);
log(
  `cold start: initialize ${summary.timings.dockerRunToInitializeMs ?? "?"} ms, session ${summary.timings.dockerRunToSessionMs ?? "?"} ms, first update ${summary.timings.dockerRunToFirstUpdateMs ?? "?"} ms`,
);
log(
  `memory idle=${formatBytes(summary.memory.idleBytes)} peak=${formatBytes(summary.memory.peakBytes)}`,
);
log(
  `usage=${JSON.stringify(summary.usage)} cost=${formatUsd(summary.costUsd)} cap=${formatUsd(summary.capUsd)} aborted=${summary.abortedBy}`,
);
process.exit(
  summary.abortedBy === "none" && summary.prompts.every((p) => p.stopReason === "end_turn") ? 0 : 1,
);
