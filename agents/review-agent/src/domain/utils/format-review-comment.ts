import type { ReviewResult, ChecklistScore } from "../entities/review-result";

export function formatReviewComment(result: ReviewResult): string {
  const lines: string[] = [];

  const emoji =
    result.decision === "approve"
      ? "APPROVED"
      : result.decision === "request_changes"
        ? "CHANGES REQUESTED"
        : "NEEDS REVIEW";

  lines.push(`## Code Review: ${emoji}`);
  lines.push(`**Overall Score:** ${result.overallScore}/100`);
  lines.push("");

  if (result.checklistScores.length > 0) {
    lines.push("### Checklist Scores");
    lines.push("");
    lines.push("| Criterion | Score | Notes |");
    lines.push("|-----------|-------|-------|");
    for (const score of result.checklistScores) {
      lines.push(
        `| ${score.label} | ${score.score}/100 | ${score.reasoning} |`
      );
    }
    lines.push("");
  }

  if (result.feedback) {
    lines.push("### Feedback");
    lines.push(result.feedback);
  }

  return lines.join("\n");
}

export function formatScoreSummary(scores: ChecklistScore[]): string {
  if (scores.length === 0) return "No scores available.";

  return scores
    .map((s) => `- **${s.label}**: ${s.score}/100 — ${s.reasoning}`)
    .join("\n");
}
