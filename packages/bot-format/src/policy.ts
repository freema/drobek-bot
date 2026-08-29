import {
  matchesToolPattern,
  type ApprovalPolicy,
  type ApprovalRuleDecision,
} from "@drobek-bot/contracts";

/**
 * What `policy.approvals` says about one tool: `deny` wins over
 * `require_approval`, which wins over `allow`. `undefined` when no pattern
 * matches; the broker decides what unlisted tools get.
 */
export function decideApproval(
  toolName: string,
  approvals: ApprovalPolicy,
): ApprovalRuleDecision | undefined {
  const matches = (patterns: readonly string[] | undefined): boolean =>
    patterns !== undefined && patterns.some((pattern) => matchesToolPattern(toolName, pattern));
  if (matches(approvals.deny)) return "deny";
  if (matches(approvals.require)) return "require_approval";
  if (matches(approvals.allow)) return "allow";
  return undefined;
}
