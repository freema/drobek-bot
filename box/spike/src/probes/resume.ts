/**
 * Spec point 5: a second prompt on the same session continues the
 * conversation; after the container is replaced, `session/load` on the same
 * home volume brings the session back.
 */
import path from "node:path";
import { runSession } from "../run.ts";
import { baseConfig, log, parseArgs } from "./common.ts";

const CODE_WORD = "PELICAN-42";
const REMEMBER = `Remember this code word for later: ${CODE_WORD}. Reply with the single word NOTED.`;
const RECALL = "What is the code word I gave you earlier? Reply with the code word only.";

const args = parseArgs("resume");

log("run 1: new session, two prompts in one container");
const first = await runSession(
  await baseConfig("resume-1", args, {
    prompts: [REMEMBER, RECALL],
    maxTurns: 2,
    outDir: path.join(args.outDir, "run-1"),
  }),
);
const recalledInSameContainer = first.prompts[1]?.agentText.includes(CODE_WORD) ?? false;
log(
  `run 1 session=${first.sessionId ?? "none"} recall in same container: ${recalledInSameContainer} (said: ${first.prompts[1]?.agentText.trim() ?? ""})`,
);

if (first.sessionId === undefined) process.exit(1);

log("run 2: new container, same volume, session/load on the same session id");
const second = await runSession(
  await baseConfig("resume-2", args, {
    prompts: [RECALL],
    maxTurns: 2,
    resumeSessionId: first.sessionId,
    outDir: path.join(args.outDir, "run-2"),
  }),
);
const loadError = second.prompts.length === 0;
const recalledAfterRestart = second.prompts[0]?.agentText.includes(CODE_WORD) ?? false;
log(
  `run 2 loaded=${!loadError} recall after container restart: ${recalledAfterRestart} (said: ${second.prompts[0]?.agentText.trim() ?? ""})`,
);
log(`costs: run1 $${first.costUsd.toFixed(5)} run2 $${second.costUsd.toFixed(5)}`);
process.exit(recalledInSameContainer && recalledAfterRestart ? 0 : 1);
