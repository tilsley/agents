import type { UpgradePlan } from "./upgrade-plan";

export type UpgradeStatus =
  /** Research determined the upgrade is too risky to automate — no PR opened. */
  | "research-blocked"
  /** The fix loop exhausted its iteration budget; PR opened with failing tests. */
  | "fix-loop-exhausted"
  /** Tests are passing after automated fixes; PR opened. */
  | "pr-created"
  /** The package is already at the target version. */
  | "already-current"
  /** Auto-discover mode found no outdated packages (or LLM declined all candidates). */
  | "no-candidates";

export interface UpgradeResult {
  status: UpgradeStatus;
  prNumber?: number;
  prUrl?: string;
  /** How many test-fix iterations the agent ran. */
  iterationsUsed?: number;
  /** Whether tests were passing when the PR was opened. */
  testsPassingOnOpen?: boolean;
  plan?: UpgradePlan;
}
