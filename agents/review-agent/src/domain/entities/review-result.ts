export type ReviewDecision = "approve" | "request_changes" | "escalate";

export type ReviewMode = "advisory" | "full";

export interface ChecklistScore {
  itemId: string;
  label: string;
  score: number;
  reasoning: string;
}

export interface ReviewResult {
  checklistScores: ChecklistScore[];
  overallScore: number;
  decision: ReviewDecision;
  feedback: string;
  mode: ReviewMode;
  advisoryReason?: string;
}
