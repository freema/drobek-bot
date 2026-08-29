/**
 * Permission policy for ACP `session/request_permission`. Pure: the decision
 * is a function of the request and the run's allowlist. Default is deny.
 */
import type { PermissionOption, PermissionOptionId, ToolKind } from "@agentclientprotocol/sdk";

export type PermissionDecision = "allow" | "deny";

/** What the host knows about a permission request when it decides. */
export type PermissionRequestView = {
  toolCallId: string;
  /** Claude Code tool name (e.g. `Bash`, `Write`, `mcp__playwright__browser_navigate`), when known. */
  toolName: string | undefined;
  kind: ToolKind | undefined;
  title: string;
  rawInput: unknown;
};

export type Policy = {
  /**
   * Tool names that may run. An entry is an exact tool name, or a prefix
   * followed by `*` (e.g. `mcp__playwright__*`). `*` alone allows everything.
   */
  allow: readonly string[];
};

/** Read-only file access is the only thing allowed unless a run says otherwise. */
export const DEFAULT_POLICY: Policy = { allow: ["Read"] };

export const DENY_ALL: Policy = { allow: [] };

export const ALLOW_ALL: Policy = { allow: ["*"] };

export function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return toolName === pattern;
}

export function decide(request: PermissionRequestView, policy: Policy): PermissionDecision {
  const name = request.toolName;
  if (name === undefined) return "deny";
  return policy.allow.some((pattern) => matchesPattern(name, pattern)) ? "allow" : "deny";
}

/**
 * Maps a decision onto the options the agent offered. Only one-shot kinds are
 * used: the host never grants "always", so every request comes back to it.
 */
export function selectOption(
  decision: PermissionDecision,
  options: readonly PermissionOption[],
): PermissionOptionId | undefined {
  const wanted = decision === "allow" ? "allow_once" : "reject_once";
  return options.find((option) => option.kind === wanted)?.optionId;
}
