import { describe, expect, test } from "bun:test";
import {
  formatReviewComment,
  formatScoreSummary,
} from "../../src/domain/utils/format-review-comment";
import type { ReviewResult } from "../../src/domain/entities/review-result";

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    checklistScores: [
      { itemId: "1", label: "Code quality", score: 85, reasoning: "Clean code" },
      { itemId: "2", label: "Tests", score: 70, reasoning: "Decent coverage" },
    ],
    overallScore: 78,
    decision: "escalate",
    feedback: "Some areas need improvement.",
    ...overrides,
  };
}

describe("formatReviewComment", () => {
  test("includes overall score", () => {
    const comment = formatReviewComment(makeResult());
    expect(comment).toContain("78/100");
  });

  test("shows APPROVED for approve decision", () => {
    const comment = formatReviewComment(makeResult({ decision: "approve" }));
    expect(comment).toContain("APPROVED");
  });

  test("shows CHANGES REQUESTED for request_changes", () => {
    const comment = formatReviewComment(
      makeResult({ decision: "request_changes" })
    );
    expect(comment).toContain("CHANGES REQUESTED");
  });

  test("shows NEEDS REVIEW for escalate", () => {
    const comment = formatReviewComment(makeResult({ decision: "escalate" }));
    expect(comment).toContain("NEEDS REVIEW");
  });

  test("includes checklist scores table", () => {
    const comment = formatReviewComment(makeResult());
    expect(comment).toContain("Code quality");
    expect(comment).toContain("85/100");
    expect(comment).toContain("Tests");
    expect(comment).toContain("70/100");
  });

  test("includes feedback section", () => {
    const comment = formatReviewComment(makeResult());
    expect(comment).toContain("Some areas need improvement.");
  });

  test("handles empty checklist scores", () => {
    const comment = formatReviewComment(makeResult({ checklistScores: [] }));
    expect(comment).toContain("78/100");
    expect(comment).not.toContain("Checklist Scores");
  });
});

describe("formatScoreSummary", () => {
  test("formats score list", () => {
    const summary = formatScoreSummary([
      { itemId: "1", label: "Quality", score: 90, reasoning: "Good" },
    ]);
    expect(summary).toContain("**Quality**: 90/100");
    expect(summary).toContain("Good");
  });

  test("returns message for empty scores", () => {
    expect(formatScoreSummary([])).toBe("No scores available.");
  });
});
