import type { ChatCompletionPort } from "@tilsley/shared";
import { truncateLog } from "@tilsley/shared";
import type {
  ClassifierLlmPort,
  ClassificationContext,
  ClassificationResult,
} from "../../application/ports/classifier-llm.port";
import type { FailureCategory } from "@tilsley/shared";

const SYSTEM_PROMPT = `You are a CI failure classifier for automated pull requests.

Given failed check run details, classify each failure as:
- "code_bug" — a real bug in the PR's code (type error, assertion failure, missing import, etc.)
- "infra_flake" — a transient infrastructure issue (timeout, network error, OOM, flaky test)
- "unknown" — cannot confidently determine the cause

Respond ONLY with valid JSON — an **array** of objects, one per check:
[{"checkRunId": <id>, "category": "code_bug"|"infra_flake"|"unknown", "errorType": "<brief type>", "errorPattern": "<key pattern matched>", "confidence": <0.0-1.0>, "reasoning": "<brief explanation>"}]

Guidelines:
- Be conservative: if unsure, use "unknown" with low confidence
- Flaky indicators: timeout, network errors, rate limits, non-deterministic ordering
- Bug indicators: compilation errors, type errors, assertion failures on changed code`;

export class CopilotClassifierAdapter implements ClassifierLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async classifyFailures(
    contexts: ClassificationContext[]
  ): Promise<ClassificationResult[]> {
    const userMessage = this.buildUserMessage(contexts);

    const response = await this.chatCompletion.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return this.parseResponse(response, contexts);
  }

  private buildUserMessage(contexts: ClassificationContext[]): string {
    const sections: string[] = [];

    if (contexts.length > 0) {
      sections.push(`## PR: ${contexts[0].prTitle}`);
      if (contexts[0].prBody) {
        sections.push(`### Description\n${contexts[0].prBody}`);
      }
    }

    for (const ctx of contexts) {
      sections.push(
        `## Failed Check: ${ctx.checkName} (ID: ${ctx.checkRunId})`
      );
      if (ctx.heuristicHint) {
        sections.push(
          `> **Pattern hint:** regex matched \`${ctx.heuristicHint.errorType}\` — suggests \`${ctx.heuristicHint.category}\`. Confirm or override based on full context.`
        );
      }
      if (ctx.checkOutput) {
        sections.push(
          `### Check Output\n\`\`\`\n${truncateLog(ctx.checkOutput, { maxLength: 3000 })}\n\`\`\``
        );
      }
      if (ctx.checkLog) {
        sections.push(
          `### Check Log\n\`\`\`\n${truncateLog(ctx.checkLog, { maxLength: 3000 })}\n\`\`\``
        );
      }
    }

    return sections.filter(Boolean).join("\n\n");
  }

  private parseResponse(
    content: string,
    contexts: ClassificationContext[]
  ): ClassificationResult[] {
    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]) as Array<{
          checkRunId?: number;
          category?: string;
          errorType?: string;
          errorPattern?: string;
          confidence?: number;
          reasoning?: string;
        }>;

        const validCategories = new Set<FailureCategory>([
          "code_bug",
          "infra_flake",
          "unknown",
        ]);

        return parsed.map((item) => ({
          checkRunId: item.checkRunId ?? 0,
          category: validCategories.has(item.category as FailureCategory)
            ? (item.category as FailureCategory)
            : "unknown",
          errorType: item.errorType ?? "unknown",
          errorPattern: item.errorPattern ?? "",
          confidence: Math.max(0, Math.min(1, item.confidence ?? 0)),
          reasoning: item.reasoning ?? "No reasoning provided",
        }));
      }

      throw new Error("No JSON array found in response");
    } catch (err) {
      console.error(
        "[copilot-classifier] Failed to parse LLM response:",
        content,
        err
      );
      return contexts.map((ctx) => ({
        checkRunId: ctx.checkRunId,
        category: "unknown" as const,
        errorType: "parse_error",
        errorPattern: "",
        confidence: 0,
        reasoning: "Failed to parse LLM response",
      }));
    }
  }
}
