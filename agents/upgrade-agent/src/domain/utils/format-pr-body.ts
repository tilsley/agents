import type { UpgradePlan } from "../entities/upgrade-plan";
import type { UpgradeResult } from "../entities/upgrade-result";

export function formatPrBody(plan: UpgradePlan, result: UpgradeResult): string {
  const { target } = plan;
  const sections: string[] = [];

  sections.push(
    `## Dependency Upgrade: \`${target.packageName}\` ${target.fromVersion} → ${target.toVersion}`
  );

  // Test status banner
  if (result.testsPassingOnOpen) {
    sections.push(`> ✅ Tests passing — this PR should be safe to merge after review.`);
  } else {
    sections.push(
      `> ⚠️ Tests were still failing when this PR was opened after ${result.iterationsUsed} fix iteration(s). Manual intervention required.`
    );
  }

  // Research summary
  sections.push(`### Research Summary\n${plan.researchSummary}`);

  // Risk
  sections.push(`### Risk Assessment\n**Risk level:** \`${plan.riskLevel}\``);

  // Breaking changes
  if (plan.expectedBreakingChanges.length > 0) {
    const items = plan.expectedBreakingChanges.map((c) => {
      let line = `- **${c.description}**`;
      if (c.apiPattern) line += `\n  - Pattern: \`${c.apiPattern}\``;
      if (c.suggestedFix) line += `\n  - Fix: ${c.suggestedFix}`;
      return line;
    });
    sections.push(`### Expected Breaking Changes\n${items.join("\n")}`);
  }

  // Known issues
  if (plan.knownIssues.length > 0) {
    const items = plan.knownIssues.map((i) => `- ${i}`).join("\n");
    sections.push(`### Known Issues in ${target.toVersion}\n${items}`);
  }

  // Automated fix summary
  if (result.iterationsUsed !== undefined) {
    const iterLabel = result.iterationsUsed === 1 ? "1 iteration" : `${result.iterationsUsed} iterations`;
    sections.push(
      `### Automated Fixes\nThe upgrade agent ran ${iterLabel} of the test-fix loop.`
    );
  }

  sections.push(
    `---\n🤖 Opened automatically by the upgrade agent. Review the diff carefully — automated callsite fixes may miss edge cases.`
  );

  return sections.join("\n\n");
}
