import type { ChatCompletionPort } from "@tilsley/shared";
import { truncateLog } from "@tilsley/shared";
import type { FixLlmPort, FixSuggestion, SourceFile } from "../../application/ports/fix-llm.port";
import type { UpgradePlan } from "../../domain/entities/upgrade-plan";

const SYSTEM_PROMPT = `You are an expert software engineer fixing compilation and test failures caused by a dependency upgrade.

You will be given:
- Failing test/build output
- A list of expected breaking changes from the upgrade research
- The current content of affected source files

Your job is to suggest minimal, targeted file edits that fix the failures.

Respond ONLY with valid JSON:
{
  "patches": [
    {"filePath": "src/foo.ts", "newContent": "<full file content>"}
  ],
  "reasoning": "Brief explanation of what you changed and why",
  "confidence": <0.0-1.0>,
  "giveUp": false
}

Guidelines:
- Return the FULL new content of each file (not a diff)
- Only patch files you are confident about
- Set giveUp: true if the failures require architectural changes or context you don't have
- confidence reflects how certain you are the patches will make the tests pass
- Preserve existing code style and formatting`;

export class CopilotFixerAdapter implements FixLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async suggestFix(input: {
    failureOutput: string;
    plan: UpgradePlan;
    affectedFiles: SourceFile[];
  }): Promise<FixSuggestion> {
    const userMessage = this.buildUserMessage(input.failureOutput, input.plan, input.affectedFiles);

    try {
      const parsed = await this.chatCompletion.completeJson<{
        patches?: Array<{ filePath?: string; newContent?: string }>;
        reasoning?: string;
        confidence?: number;
        giveUp?: boolean;
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ]);

      return this.coerceResponse(parsed);
    } catch (err) {
      console.error("[copilot-fixer] Failed to get/parse LLM response:", err);
      return {
        patches: [],
        reasoning: "Failed to parse fix suggestion",
        confidence: 0,
        giveUp: false,
      };
    }
  }

  private buildUserMessage(
    failureOutput: string,
    plan: UpgradePlan,
    affectedFiles: SourceFile[]
  ): string {
    const sections: string[] = [];

    sections.push(
      `## Upgrade Context\n${plan.target.packageName} ${plan.target.fromVersion} → ${plan.target.toVersion}`
    );

    if (plan.expectedBreakingChanges.length > 0) {
      const changes = plan.expectedBreakingChanges
        .map((c) => {
          let line = `- ${c.description}`;
          if (c.apiPattern) line += `\n  Pattern: \`${c.apiPattern}\``;
          if (c.suggestedFix) line += `\n  Fix: ${c.suggestedFix}`;
          return line;
        })
        .join("\n");
      sections.push(`## Expected Breaking Changes\n${changes}`);
    }

    sections.push(
      `## Failing Output\n\`\`\`\n${truncateLog(failureOutput, { maxLength: 4000 })}\n\`\`\``
    );

    for (const file of affectedFiles) {
      sections.push(`## File: ${file.path}\n\`\`\`typescript\n${file.content}\n\`\`\``);
    }

    return sections.join("\n\n");
  }

  private coerceResponse(parsed: {
    patches?: Array<{ filePath?: string; newContent?: string }>;
    reasoning?: string;
    confidence?: number;
    giveUp?: boolean;
  }): FixSuggestion {
    return {
      patches: (parsed.patches ?? [])
        .filter((p) => p.filePath && p.newContent)
        .map((p) => ({ filePath: p.filePath!, newContent: p.newContent! })),
      reasoning: parsed.reasoning ?? "No reasoning provided",
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0)),
      giveUp: parsed.giveUp ?? false,
    };
  }
}
