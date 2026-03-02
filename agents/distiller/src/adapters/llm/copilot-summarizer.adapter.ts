import type { ChatCompletionPort, Lesson } from "@tilsley/shared";
import { truncateLog } from "@tilsley/shared";
import type { SummarizerLlmPort } from "../../application/ports/summarizer-llm.port";
import type { PipelineSummary } from "../../domain/entities/pipeline-summary";

const SYSTEM_PROMPT = `You are a knowledge distiller for a CI/CD pipeline. Given the full context of a pipeline run (PR, failures, review results), extract actionable lessons learned.

Respond ONLY with valid JSON — an **array** of lesson objects:
[{"problem": "<what went wrong or was notable>", "solution": "<how it was resolved or should be handled>", "context": "<where/when this applies>", "outcome": "<result of the resolution>", "tags": ["<tag1>", "<tag2>"], "metadata": {}}]

Guidelines:
- Extract 1-5 lessons per pipeline run
- Focus on patterns that would help in future: recurring failures, review feedback, architectural insights
- Be specific and actionable
- Tags should be lowercase, descriptive (e.g., "testing", "ci-flake", "type-safety")
- If nothing notable happened, return an empty array []`;

export class CopilotSummarizerAdapter implements SummarizerLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async summarize(context: PipelineSummary, focus?: string): Promise<Lesson[]> {
    const systemPrompt = focus
      ? `${SYSTEM_PROMPT}\n\nFocus area for this run: ${focus}`
      : SYSTEM_PROMPT;

    const userMessage = this.buildUserMessage(context);

    const response = await this.chatCompletion.complete([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);

    return this.parseResponse(response);
  }

  private buildUserMessage(context: PipelineSummary): string {
    const sections: string[] = [
      `## PR: ${context.pullRequest.title}`,
      context.pullRequest.body
        ? `### Description\n${context.pullRequest.body}`
        : "",
      `### Head SHA: ${context.headSha}`,
    ];

    if (context.failureSignatures.length > 0) {
      sections.push("### CI Failures");
      for (const sig of context.failureSignatures) {
        sections.push(
          `- **${sig.checkName}**: ${sig.category} — ${sig.errorType} (${sig.errorPattern})`
        );
      }
    }

    sections.push(`### Review Score: ${context.reviewScore}/100`);
    sections.push(`### Review Decision: ${context.reviewDecision}`);

    if (context.reviewFeedback) {
      sections.push(
        `### Review Feedback\n${truncateLog(context.reviewFeedback, { maxLength: 2000 })}`
      );
    }

    if (context.diff) {
      sections.push(
        `### Diff Summary\n\`\`\`diff\n${truncateLog(context.diff, { maxLength: 3000 })}\n\`\`\``
      );
    }

    return sections.filter(Boolean).join("\n\n");
  }

  private parseResponse(content: string): Lesson[] {
    try {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]) as Array<{
          problem?: string;
          solution?: string;
          context?: string;
          outcome?: string;
          tags?: string[];
          metadata?: Record<string, unknown>;
        }>;

        return parsed.map((item) => ({
          problem: item.problem ?? "",
          solution: item.solution ?? "",
          context: item.context ?? "",
          outcome: item.outcome ?? "",
          tags: item.tags ?? [],
          metadata: item.metadata ?? {},
        }));
      }

      throw new Error("No JSON array found in response");
    } catch (err) {
      console.error(
        "[copilot-summarizer] Failed to parse response:",
        content,
        err
      );
      return [];
    }
  }
}
