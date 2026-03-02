import type { LlmPort, AnalysisContext, EvalContext } from "../../application/ports/llm.port";
import type { ReviewDecision, ReviewAction } from "../../domain/entities/review-decision";
import { truncateLog } from "../../domain/utils/truncate-log";

const SYSTEM_PROMPT = `You are a CI failure analyst for automated pull requests.

Given a PR and its failed check run details, determine whether each failure is:
- A **flaky test** or transient infrastructure issue → action: "rerun"
- A **legitimate failure** caused by the PR's changes → action: "close"
- **Unclear or not actionable** → action: "skip"

Respond ONLY with valid JSON — an **array** of objects, one per check, in this exact format:
[{"checkRunId": <id>, "action": "rerun" | "close" | "skip", "reason": "<brief explanation>"}]

If there is only one check, still return an array with one element.

Guidelines:
- Flaky indicators: timeout without code changes, network errors, rate limits, non-deterministic test ordering, known flaky test names
- Legitimate failure indicators: compilation errors, type errors, test assertions that directly test changed code, missing imports
- When unsure, prefer "skip" over incorrect action`;

export interface CopilotClientConfig {
  token: string;
  endpoint?: string;
}

export class CopilotAdapter implements LlmPort {
  private token: string;
  private endpoint: string;

  constructor(config: CopilotClientConfig) {
    this.token = config.token;
    this.endpoint =
      config.endpoint ?? "https://api.githubcopilot.com/chat/completions";
  }

  async analyzeCheckFailure(context: AnalysisContext): Promise<ReviewDecision[]> {
    const userMessage = this.buildUserMessage(context);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(
        `[copilot] API error: ${response.status} ${response.statusText}`
      );
      return context.checks.map((check) => ({
        action: "skip" as const,
        reason: "LLM API error",
        checkRunId: check.checkRunId,
      }));
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parseDecisions(content, context);
  }

  private buildUserMessage(context: AnalysisContext): string {
    const sections = [
      `## PR: ${context.prTitle}`,
      context.prBody ? `### Description\n${context.prBody}` : "",
    ];

    for (const check of context.checks) {
      sections.push(`## Failed Check: ${check.checkName} (ID: ${check.checkRunId})`);
      if (check.checkOutput) {
        sections.push(
          `### Check Output\n\`\`\`\n${truncateLog(check.checkOutput, { maxLength: 3000 })}\n\`\`\``
        );
      }
      if (check.checkLog) {
        sections.push(
          `### Check Log\n\`\`\`\n${truncateLog(check.checkLog, { maxLength: 3000 })}\n\`\`\``
        );
      }
    }

    return sections.filter(Boolean).join("\n\n");
  }

  async evaluatePullRequest(context: EvalContext): Promise<{
    score: number;
    summary: string;
    breakdown: Array<{ criterion: string; score: number; reasoning: string }>;
  }> {
    const systemPrompt =
      context.evalPrompt +
      `\n\nRespond ONLY with valid JSON in this exact format:
{"score": <0-100>, "summary": "<brief summary>", "breakdown": [{"criterion": "<name>", "score": <0-100>, "reasoning": "<explanation>"}]}`;

    const userMessage = this.buildEvalUserMessage(context);

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(
        `[copilot] Eval API error: ${response.status} ${response.statusText}`
      );
      return { score: 50, summary: "LLM API error — defaulting to neutral score", breakdown: [] };
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return this.parseEvalResult(content);
  }

  private buildEvalUserMessage(context: EvalContext): string {
    const sections = [
      `## PR: ${context.prTitle}`,
      context.prBody ? `### Description\n${context.prBody}` : "",
      `### Diff\n\`\`\`diff\n${context.prDiff}\n\`\`\``,
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  private parseEvalResult(content: string): {
    score: number;
    summary: string;
    breakdown: Array<{ criterion: string; score: number; reasoning: string }>;
  } {
    try {
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (!objectMatch) throw new Error("No JSON found in response");

      const parsed = JSON.parse(objectMatch[0]) as {
        score?: number;
        summary?: string;
        breakdown?: Array<{
          criterion?: string;
          score?: number;
          reasoning?: string;
        }>;
      };

      const clamp = (n: number) => Math.max(0, Math.min(100, n));

      return {
        score: clamp(parsed.score ?? 50),
        summary: parsed.summary ?? "No summary provided",
        breakdown: (parsed.breakdown ?? []).map((item) => ({
          criterion: item.criterion ?? "Unknown",
          score: clamp(item.score ?? 50),
          reasoning: item.reasoning ?? "No reasoning provided",
        })),
      };
    } catch (err) {
      console.error("[copilot] Failed to parse eval response:", content, err);
      return { score: 50, summary: "Failed to parse LLM response — defaulting to neutral score", breakdown: [] };
    }
  }

  private parseDecisions(
    content: string,
    context: AnalysisContext
  ): ReviewDecision[] {
    try {
      // Try to extract JSON array first
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]) as Array<{
          checkRunId?: number;
          action: string;
          reason: string;
        }>;

        const validActions = new Set<ReviewAction>(["rerun", "close", "skip"]);
        return parsed.map((item) => ({
          action: validActions.has(item.action as ReviewAction)
            ? (item.action as ReviewAction)
            : "skip",
          reason: item.reason ?? "No reason provided",
          checkRunId: item.checkRunId ?? 0,
        }));
      }

      // Fall back to single-object parse for backward compatibility
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        const parsed = JSON.parse(objectMatch[0]) as {
          checkRunId?: number;
          action: string;
          reason: string;
        };

        const validActions = new Set<ReviewAction>(["rerun", "close", "skip"]);
        const action: ReviewAction = validActions.has(parsed.action as ReviewAction)
          ? (parsed.action as ReviewAction)
          : "skip";

        return [
          {
            action,
            reason: parsed.reason ?? "No reason provided",
            checkRunId: parsed.checkRunId ?? context.checks[0]?.checkRunId ?? 0,
          },
        ];
      }

      throw new Error("No JSON found in response");
    } catch (err) {
      console.error("[copilot] Failed to parse LLM response:", content, err);
      return context.checks.map((check) => ({
        action: "skip" as const,
        reason: "Failed to parse LLM response",
        checkRunId: check.checkRunId,
      }));
    }
  }
}
