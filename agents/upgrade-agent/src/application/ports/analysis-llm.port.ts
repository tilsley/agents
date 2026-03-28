import type { UsageSite, CodebaseAnalysis } from "../../domain/entities/codebase-analysis";
import type { UpgradeTarget } from "../../domain/entities/upgrade-target";

export interface AnalysisLlmPort {
  /** Analyse how a package is used in the codebase given pre-gathered usage snippets. */
  analyse(target: UpgradeTarget, usageSites: UsageSite[]): Promise<CodebaseAnalysis>;
}
