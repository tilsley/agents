export interface FeedbackClassification {
  isRule: boolean;
  ruleText: string;
  ruleType: "documentation" | "upgrade-constraint" | "code-style";
  scope: "global" | "repo";
  reasoning: string;
}

export interface FeedbackClassifierLlmPort {
  classify(commentBody: string, prBody: string): Promise<FeedbackClassification>;
}
