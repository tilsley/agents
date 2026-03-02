import type { FailureAnalysis } from "../entities/failure-analysis";

export function formatFailureReport(analyses: FailureAnalysis[]): string {
  if (analyses.length === 0) {
    return "No failures to report.";
  }

  const lines: string[] = [`## Failure Analysis Report (${analyses.length} checks)`];

  for (const a of analyses) {
    lines.push("");
    lines.push(`### ${a.checkName} (ID: ${a.checkRunId})`);
    lines.push(`- **Category:** ${a.category}`);
    lines.push(`- **Decision:** ${a.decision}`);
    lines.push(`- **Error type:** ${a.signature.errorType}`);
    lines.push(`- **Pattern:** \`${a.signature.errorPattern}\``);
    lines.push(`- **Confidence:** ${(a.signature.confidence * 100).toFixed(0)}%`);
    lines.push(`- **Reasoning:** ${a.reasoning}`);
  }

  return lines.join("\n");
}
