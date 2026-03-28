import type { Lesson, GitHubIssueResult, ToolExecutor } from "@tilsley/shared";
import type { UpgradeTarget } from "../../domain/entities/upgrade-target";
import type { UpgradePlan } from "../../domain/entities/upgrade-plan";
import type { CodebaseAnalysis } from "../../domain/entities/codebase-analysis";

export interface RawResearch {
  /** Concatenated release notes / CHANGELOG between fromVersion and toVersion. */
  changelog: string;
  /** Past lessons from the distiller memory store relevant to this package. */
  pastLessons: Lesson[];
  /** LLM-generated analysis of how the package is used in the codebase. */
  codebaseAnalysis?: CodebaseAnalysis;
  /** GitHub issues from the upstream repo mentioning the target version. */
  githubIssues?: GitHubIssueResult[];
}

export interface ResearchLlmPort {
  /**
   * Synthesises raw research into a structured upgrade plan.
   * Determines risk level, whether to proceed, and what breaking changes to expect.
   * When toolExecutor is provided, the LLM can inspect the codebase during research.
   */
  synthesise(
    target: UpgradeTarget,
    research: RawResearch,
    toolExecutor?: ToolExecutor
  ): Promise<UpgradePlan>;
}
