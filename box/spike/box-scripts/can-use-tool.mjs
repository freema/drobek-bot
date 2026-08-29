// Runs INSIDE the box (plain Node, no TypeScript): drives the same CLI through
// the Claude Agent SDK that the ACP adapter bundles, and prints which tool
// calls reach `canUseTool` versus the `PreToolUse` hook. Fallback experiment
// for the actions that never raise `session/request_permission` over ACP.
import process from "node:process";
import { query } from "/usr/local/lib/node_modules/@zed-industries/claude-code-acp/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs";

const emit = (record) => process.stdout.write(JSON.stringify(record) + "\n");
const prompt =
  process.argv[2] ??
  "Run `uname -a` with the Bash tool, then read notes.txt with the Read tool, then reply OK.";

const q = query({
  prompt,
  options: {
    cwd: process.cwd(),
    pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE,
    model: "claude-haiku-4-5",
    maxTurns: 4,
    permissionMode: "default",
    settingSources: ["project"],
    canUseTool: async (toolName, input) => {
      emit({ event: "canUseTool", toolName, input });
      return { behavior: "allow", updatedInput: input };
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              emit({ event: "PreToolUse", toolName: input.tool_name, input: input.tool_input });
              return { continue: true };
            },
          ],
        },
      ],
    },
  },
});

for await (const message of q) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "tool_use")
        emit({ event: "tool_use", toolName: block.name, input: block.input });
    }
  }
  if (message.type === "result") {
    emit({
      event: "result",
      subtype: message.subtype,
      model: Object.keys(message.modelUsage ?? {}),
      total_cost_usd: message.total_cost_usd,
      usage: message.usage,
      num_turns: message.num_turns,
    });
  }
}
