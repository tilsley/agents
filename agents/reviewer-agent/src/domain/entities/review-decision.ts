export type ReviewAction = "rerun" | "close" | "skip";

export interface ReviewDecision {
  action: ReviewAction;
  reason: string;
  checkRunId: number;
}
