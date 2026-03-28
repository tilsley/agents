export interface UsageSite {
  filePath: string;
  /** ~20 lines around the import/callsite. */
  snippet: string;
}

export interface CodebaseAnalysis {
  fileCount: number;
  usageCount: number;
  /** Whether the package is wrapped in an abstraction vs used directly. */
  isWrapped: boolean;
  /** LLM-generated summary of how the package is used. */
  usageSummary: string;
  /** Version-sensitive API patterns spotted in the codebase. */
  riskyPatterns: string[];
  /** Sample usage sites (capped). */
  usageSites: UsageSite[];
}
