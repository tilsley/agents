import type { ReviewDecision } from "../../domain/entities/review-decision";

export interface CheckFailureContext {
  checkName: string;
  checkRunId: number;
  checkOutput: string;
  checkLog: string;
}

export interface AnalysisContext {
  prTitle: string;
  prBody: string;
  checks: CheckFailureContext[];
}

export interface EvalContext {
  prTitle: string;
  prBody: string;
  prDiff: string;
  evalPrompt: string;
}

export interface LlmPort {
  analyzeCheckFailure(context: AnalysisContext): Promise<ReviewDecision[]>;

  evaluatePullRequest(context: EvalContext): Promise<{
    score: number;
    summary: string;
    breakdown: Array<{ criterion: string; score: number; reasoning: string }>;
  }>;
}
