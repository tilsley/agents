import type { ChatCompletionPort } from "@tilsley/shared";
import { truncateLog } from "@tilsley/shared";
import type {
  ReviewerLlmPort,
  ReviewerLlmContext,
} from "../../application/ports/reviewer-llm.port";
import type { ChecklistScore } from "../../domain/entities/review-result";

const SYSTEM_PROMPT = `You are an expert code reviewer. Given a PR diff and a checklist of review criteria, evaluate each item.

Respond ONLY with valid JSON — an **array** of objects:
[{"itemId": "<id>", "label": "<label>", "score": <0-100>, "reasoning": "<brief explanation>"}]

Guidelines:
- Score each checklist item from 0-100
- Provide brief, actionable reasoning
- Consider relevant lessons from past reviews when provided
- When CI failures are provided, distinguish: "code_bug" means the PR likely caused it (penalise correctness), "infra_flake" means it is unrelated to this PR (do not penalise)
- Be constructive, not harsh`;

export class CopilotReviewerAdapter implements ReviewerLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async evaluateChecklist(context: ReviewerLlmContext): Promise<ChecklistScore[]> {
    const userMessage = this.buildUserMessage(context);

    const response = await this.chatCompletion.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return this.parseResponse(response, context);
  }

  private buildUserMessage(context: ReviewerLlmContext): string {
    const sections: string[] = [
      `## PR: ${context.prTitle}`,
      context.prBody ? `### Description\n${context.prBody}` : "",
      `### Diff\n\`\`\`diff\n${truncateLog(context.diff, { maxLength: 8000 })}\n\`\`\``,
      `### Checklist (${context.checklist.taskType})`,
      ...context.checklist.items.map(
        (item) => `- [${item.id}] **${item.label}** (weight: ${item.weight}): ${item.description}`
      ),
    ];

    if (context.failureSignatures && context.failureSignatures.length > 0) {
      sections.push("### CI Failures");
      for (const sig of context.failureSignatures) {
        const label =
          sig.category === "code_bug"
            ? "CAUSED BY THIS PR"
            : sig.category === "infra_flake"
              ? "FLAKY / INFRA (not caused by this PR)"
              : "UNKNOWN CAUSE";
        sections.push(
          `- **${sig.checkName}** [${label}]: ${sig.errorType} — \`${sig.errorPattern}\``
        );
      }
    }

    if (context.relevantLessons.length > 0) {
      sections.push("### Relevant Lessons from Past Reviews");
      for (const lesson of context.relevantLessons) {
        sections.push(`- **Problem:** ${lesson.problem} → **Solution:** ${lesson.solution}`);
      }
    }

    return sections.filter(Boolean).join("\n\n");
  }

  private parseResponse(
    content: string,
    context: ReviewerLlmContext
  ): ChecklistScore[] {
    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]) as Array<{
          itemId?: string;
          label?: string;
          score?: number;
          reasoning?: string;
        }>;

        const clamp = (n: number) => Math.max(0, Math.min(100, n));

        return parsed.map((item) => ({
          itemId: item.itemId ?? "unknown",
          label: item.label ?? "Unknown",
          score: clamp(item.score ?? 50),
          reasoning: item.reasoning ?? "No reasoning provided",
        }));
      }

      throw new Error("No JSON array found in response");
    } catch (err) {
      console.error("[copilot-reviewer] Failed to parse response:", content, err);
      return context.checklist.items.map((item) => ({
        itemId: item.id,
        label: item.label,
        score: 50,
        reasoning: "Failed to parse LLM response — defaulting to neutral score",
      }));
    }
  }
}
