import type { RiskLevel } from "../../domain/entities/upgrade-plan";

export interface UpgradeCandidate {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  riskLevel: RiskLevel;
}

export interface DiscoveryLlmPort {
  /**
   * Given a list of outdated packages, select the single best candidate to
   * upgrade. Returns null if none are suitable.
   */
  selectTarget(candidates: UpgradeCandidate[]): Promise<UpgradeCandidate | null>;
}
