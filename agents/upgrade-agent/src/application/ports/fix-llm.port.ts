import type { UpgradePlan } from "../../domain/entities/upgrade-plan";

export interface SourceFile {
  path: string;
  content: string;
}

export interface FilePatch {
  filePath: string;
  /** Full new content of the file. */
  newContent: string;
}

export interface FixSuggestion {
  patches: FilePatch[];
  reasoning: string;
  /** 0.0–1.0 confidence that these patches will resolve the failures. */
  confidence: number;
  /**
   * True when the LLM believes the remaining failures are not fixable automatically
   * (e.g. require architecture decisions or missing context).
   */
  giveUp: boolean;
}

export interface FixLlmPort {
  /**
   * Given failing test output and the upgrade plan's expected breaking changes,
   * suggest file-level patches to apply.
   *
   * The use case reads the affected files from the working directory and passes
   * their current content here so the LLM has full context.
   */
  suggestFix(input: {
    failureOutput: string;
    plan: UpgradePlan;
    affectedFiles: SourceFile[];
  }): Promise<FixSuggestion>;
}
