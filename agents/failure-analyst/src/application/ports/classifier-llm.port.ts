import type { FailureCategory } from "@tilsley/shared";

export interface ClassificationContext {
  checkName: string;
  checkRunId: number;
  checkOutput: string;
  checkLog: string;
  prTitle: string;
  prBody: string;
}

export interface ClassificationResult {
  checkRunId: number;
  category: FailureCategory;
  errorType: string;
  errorPattern: string;
  confidence: number;
  reasoning: string;
}

export interface ClassifierLlmPort {
  classifyFailures(
    context: ClassificationContext[]
  ): Promise<ClassificationResult[]>;
}
