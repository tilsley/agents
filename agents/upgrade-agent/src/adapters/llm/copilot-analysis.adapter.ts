import type { ChatCompletionPort } from "@tilsley/shared";
import type { AnalysisLlmPort } from "../../application/ports/analysis-llm.port";
import type { UpgradeTarget } from "../../domain/entities/upgrade-target";
import type { UsageSite, CodebaseAnalysis } from "../../domain/entities/codebase-analysis";

const SYSTEM_PROMPT = `You are a software engineer analysing how a package is used in a codebase before upgrading it.

Given the package name, version range, and code snippets showing where the package is imported or called, produce a structured analysis.

Respond ONLY with valid JSON:
{
  "isWrapped": boolean,
  "usageSummary": "2-4 sentence summary of how the package is used",
  "riskyPatterns": ["version-sensitive API patterns spotted"]
}

Guidelines:
- isWrapped: true if the package is imported in one place and re-exported/wrapped behind an abstraction layer; false if it is used directly across many files
- usageSummary: describe the main use cases — what APIs are called, how deeply coupled the codebase is to the package
- riskyPatterns: list specific API usages that are known to change across major versions (deprecated methods, configuration patterns, callback signatures, etc.)
- If no risky patterns are evident, return an empty array — do not invent risks`;

export class CopilotAnalysisAdapter implements AnalysisLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async analyse(target: UpgradeTarget, usageSites: UsageSite[]): Promise<CodebaseAnalysis> {
    const userMessage = this.buildUserMessage(target, usageSites);

    try {
      const parsed = await this.chatCompletion.completeJson<{
        isWrapped?: boolean;
        usageSummary?: string;
        riskyPatterns?: string[];
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ]);

      return this.coerceResponse(parsed, usageSites);
    } catch (err) {
      console.error("[copilot-analysis] Failed to get/parse LLM response:", err);
      return {
        fileCount: new Set(usageSites.map((s) => s.filePath)).size,
        usageCount: usageSites.length,
        isWrapped: false,
        usageSummary: "Codebase analysis failed (LLM parse error).",
        riskyPatterns: [],
        usageSites,
      };
    }
  }

  private buildUserMessage(target: UpgradeTarget, usageSites: UsageSite[]): string {
    const sections: string[] = [];

    sections.push(
      `## Package: ${target.packageName}`,
      `**Upgrading:** ${target.fromVersion} → ${target.toVersion}`,
      `**Files using this package:** ${new Set(usageSites.map((s) => s.filePath)).size}`,
      `**Total usage sites:** ${usageSites.length}`
    );

    if (usageSites.length > 0) {
      const snippets = usageSites
        .map((s) => `### ${s.filePath}\n\`\`\`\n${s.snippet}\n\`\`\``)
        .join("\n\n");
      sections.push(`## Usage Snippets\n${snippets}`);
    }

    return sections.join("\n\n");
  }

  private coerceResponse(
    parsed: {
      isWrapped?: boolean;
      usageSummary?: string;
      riskyPatterns?: string[];
    },
    usageSites: UsageSite[]
  ): CodebaseAnalysis {
    return {
      fileCount: new Set(usageSites.map((s) => s.filePath)).size,
      usageCount: usageSites.length,
      isWrapped: parsed.isWrapped ?? false,
      usageSummary: parsed.usageSummary ?? "No usage summary provided.",
      riskyPatterns: parsed.riskyPatterns ?? [],
      usageSites,
    };
  }
}
