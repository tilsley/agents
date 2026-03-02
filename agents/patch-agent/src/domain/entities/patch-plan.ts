import type { Vulnerability, VulnerabilitySeverity } from "./vulnerability";

export interface PackageFix {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  // All vulns this single version bump resolves
  vulnerabilities: Vulnerability[];
  highestSeverity: VulnerabilitySeverity;
}

export interface SkippedFix {
  fix: PackageFix;
  reason: string;
}

export interface PatchPlan {
  fixes: PackageFix[];
  // Fixes skipped by the safety policy (e.g. semver downgrades)
  skipped: SkippedFix[];
  // Vulns we found but cannot auto-fix (isUpgradable: false)
  unfixable: Vulnerability[];
  branch: string;
  prTitle: string;
}

export type CheckStep = "build" | "test" | "none";

export interface CheckResult {
  success: boolean;
  /** Which step was last run (or attempted). */
  step: CheckStep;
  /** Truncated combined stdout+stderr from the failing step. */
  output: string;
}

export interface PatchResult {
  status: "clean" | "pr-created" | "no-fixable-vulns";
  prNumber?: number;
  prUrl?: string;
  plan?: PatchPlan;
  checks?: CheckResult;
}
