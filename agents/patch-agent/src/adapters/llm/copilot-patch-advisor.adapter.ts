import type { ChatCompletionPort, Lesson } from "@tilsley/shared";
import type { PatchAdvisorLlmPort, PatchAdvice } from "../../application/ports/patch-advisor-llm.port";
import type { PatchPlan } from "../../domain/entities/patch-plan";

const SYSTEM_PROMPT = `You are reviewing a proposed automated vulnerability patch plan before it is executed.

You have access to lessons learned from previous patch attempts on this repository and in general.

Analyse the proposed fixes and return structured advice. Check for:

1. SEMVER DOWNGRADES: Is any version change actually a downgrade (toVersion < fromVersion by major/minor)? Flag these as high risk.
2. MAJOR VERSION JUMPS: Do any fixes jump a major version (e.g. v1→v2, v4→v5)? These often require migration steps.
3. SCOPE: Are many unrelated packages bundled together? Should this be split into separate PRs?
4. KNOWN ISSUES: Based on the lessons provided, are there known migration requirements, environment prerequisites, or failure patterns to call out?

For packagesToDefer: list the exact packageName of any fix that is TOO RISKY to apply automatically in this PR.
Use this when:
- A lesson documents that this package's upgrade previously broke the build or required manual steps
- A major version jump has known breaking changes that need migration work before the bump is safe
- The lesson explicitly says "do not auto-upgrade" or "requires manual review"
Do NOT defer a fix just because it is a major version bump — only defer if lessons or clear evidence suggest the auto-apply will fail.
Leave packagesToDefer empty if you have no specific reason to defer a fix.

Respond ONLY with valid JSON:
{
  "warnings": ["..."],
  "migrationNotes": ["..."],
  "scopingRecommendation": "..." | null,
  "riskLevel": "low" | "medium" | "high",
  "packagesToDefer": ["exact-package-name", ...]
}

warnings: blockers or high-risk flags the reviewer must see (empty array if none)
migrationNotes: concrete steps that must accompany this patch (empty array if none)
scopingRecommendation: advice on splitting the PR, or null if scope looks fine
riskLevel: overall risk assessment based on the above
packagesToDefer: package names to remove from this automated PR (empty array if none)`;

export class CopilotPatchAdvisorAdapter implements PatchAdvisorLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async advise(plan: PatchPlan, lessons: Lesson[]): Promise<PatchAdvice> {
    const userMessage = this.buildUserMessage(plan, lessons);

    const response = await this.chatCompletion.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return this.parseResponse(response);
  }

  private buildUserMessage(plan: PatchPlan, lessons: Lesson[]): string {
    const sections: string[] = [];

    sections.push("## Proposed Patch Plan");
    sections.push(
      plan.fixes
        .map(
          (f) =>
            `- **${f.packageName}**: ${f.fromVersion} → ${f.toVersion} ` +
            `(${f.highestSeverity}, ${f.vulnerabilities.length} vuln(s))`
        )
        .join("\n")
    );

    if (lessons.length > 0) {
      sections.push("## Lessons from Previous Patch Runs");
      sections.push(
        lessons
          .map((l, i) => `${i + 1}. **Problem**: ${l.problem}\n   **Solution**: ${l.solution}`)
          .join("\n\n")
      );
    } else {
      sections.push("## Lessons from Previous Patch Runs\n(none yet)");
    }

    return sections.join("\n\n");
  }

  private parseResponse(content: string): PatchAdvice {
    try {
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        const parsed = JSON.parse(objectMatch[0]) as Partial<PatchAdvice>;
        return {
          warnings: parsed.warnings ?? [],
          migrationNotes: parsed.migrationNotes ?? [],
          scopingRecommendation: parsed.scopingRecommendation ?? null,
          riskLevel: parsed.riskLevel ?? "low",
          packagesToDefer: parsed.packagesToDefer ?? [],
        };
      }
      throw new Error("No JSON object found in response");
    } catch (err) {
      console.error("[patch-advisor] Failed to parse response:", content, err);
      return { warnings: [], migrationNotes: [], scopingRecommendation: null, riskLevel: "low", packagesToDefer: [] };
    }
  }
}
