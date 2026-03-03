import type { FailureDecision } from "@tilsley/failure-analyst/src/domain/entities/failure-analysis";
import type { ReviewMode } from "@tilsley/review-agent/src/domain/entities/review-result";

interface ReviewModeResult {
  mode: ReviewMode;
  reason?: string;
}

export function deriveReviewMode(decisions: FailureDecision[]): ReviewModeResult {
  if (decisions.some((d) => d === "route_to_fixer")) {
    return {
      mode: "advisory",
      reason: "CI detected a code bug — fix the underlying failure before merging.",
    };
  }

  if (decisions.some((d) => d === "escalate")) {
    return {
      mode: "advisory",
      reason: "CI failure could not be resolved after retries — needs human attention.",
    };
  }

  return { mode: "full" };
}
