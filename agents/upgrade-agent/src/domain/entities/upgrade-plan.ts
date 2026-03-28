import type { UpgradeTarget } from "./upgrade-target";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ExpectedBreakingChange {
  /** Human-readable description of what changed. */
  description: string;
  /** Code pattern to look for in the codebase (e.g. "new Foo(bar)" → "new Foo(bar, opts)"). */
  apiPattern?: string;
  /** How to fix it when encountered. */
  suggestedFix?: string;
}

export interface UpgradePlan {
  target: UpgradeTarget;
  /** Heuristic + research derived risk level. */
  riskLevel: RiskLevel;
  /** Whether the agent should attempt the automated upgrade. */
  shouldProceed: boolean;
  /** Known breaking changes the fix loop should watch for. */
  expectedBreakingChanges: ExpectedBreakingChange[];
  /** Known bugs / regressions in the target version to flag in the PR. */
  knownIssues: string[];
  /** Human-readable research summary for the PR body. */
  researchSummary: string;
}
