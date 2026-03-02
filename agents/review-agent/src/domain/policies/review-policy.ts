import type { ReviewDecision } from "../entities/review-result";

export interface ReviewThresholds {
  approveAbove: number;
  rejectBelow: number;
}

const DEFAULT_THRESHOLDS: ReviewThresholds = {
  approveAbove: 80,
  rejectBelow: 40,
};

export function makeReviewDecision(
  overallScore: number,
  thresholds: ReviewThresholds = DEFAULT_THRESHOLDS
): ReviewDecision {
  if (overallScore >= thresholds.approveAbove) return "approve";
  if (overallScore <= thresholds.rejectBelow) return "request_changes";
  return "escalate";
}

export function calculateOverallScore(
  scores: Array<{ score: number; weight: number }>
): number {
  if (scores.length === 0) return 0;

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedSum = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
  return Math.round(weightedSum / totalWeight);
}
