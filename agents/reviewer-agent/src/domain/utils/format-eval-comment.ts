import type { EvalResult } from "../entities/eval-result";

export function formatEvalComment(result: EvalResult): string {
  const lines: string[] = [];

  lines.push(`## PR Eval: ${result.score}/100`);
  lines.push("");
  lines.push(result.summary);

  if (result.breakdown.length > 0) {
    lines.push("");
    lines.push("| Criterion | Score | Reasoning |");
    lines.push("|-----------|-------|-----------|");
    for (const item of result.breakdown) {
      lines.push(`| ${item.criterion} | ${item.score} | ${item.reasoning} |`);
    }
  }

  if (result.action === "approve") {
    lines.push("");
    lines.push("**Action:** Auto-approved");
  } else if (result.action === "request_changes") {
    lines.push("");
    lines.push("**Action:** Changes requested");
  }

  return lines.join("\n");
}
