import type { ToolUseChatCompletionPort, ToolExecutor } from "@tilsley/shared";
import type { ResearchLlmPort, RawResearch } from "../../application/ports/research-llm.port";
import type { UpgradeTarget } from "../../domain/entities/upgrade-target";
import type { UpgradePlan, RiskLevel, ExpectedBreakingChange } from "../../domain/entities/upgrade-plan";
import { deriveRiskLevel } from "../../domain/policies/risk-policy";
import { RESEARCHER_TOOLS } from "../../domain/tools/researcher-tools";

type RawPlan = {
  riskLevel?: string;
  shouldProceed?: boolean;
  expectedBreakingChanges?: Array<{ description?: string; apiPattern?: string; suggestedFix?: string }>;
  knownIssues?: string[];
  researchSummary?: string;
};

// Phase 1: tool-use — gather free-form findings about the codebase
const INVESTIGATION_PROMPT = `You are an expert software engineer analysing a dependency upgrade.

You MUST use the provided tools to inspect the actual source code before giving your answer. Do not skip tool use — your findings must be grounded in real code, not assumptions.

Start by calling list_files or grep to understand the codebase, then use read_file to examine specific files. Investigate:
1. How the package is actually imported and used (callsites, patterns, abstractions)
2. Whether the breaking changes listed in the changelog affect this specific project
3. Any risky usage patterns (direct use of changed APIs, lack of abstraction layer, etc.)

After investigating with tools, summarise your findings in plain text. Focus on what you discovered — do not produce JSON.`;

// Phase 2: synthesis — convert findings + research into structured JSON
const SYNTHESIS_PROMPT = `You are an expert software engineer specialising in dependency upgrade analysis.

Given changelog entries, GitHub issues, past lessons, and codebase investigation findings for a package upgrade, produce a structured analysis.

Respond ONLY with valid JSON:
{
  "riskLevel": "low"|"medium"|"high"|"critical",
  "shouldProceed": boolean,
  "expectedBreakingChanges": [
    {"description": "...", "apiPattern": "...", "suggestedFix": "..."}
  ],
  "knownIssues": ["..."],
  "researchSummary": "2–4 sentence summary of findings"
}

Guidelines:
- shouldProceed: true if the upgrade can be attempted with automated callsite fixes
- shouldProceed: false only if there are known production regressions, the upgrade requires architectural decisions, or the changelog indicates widespread incompatibility
- riskLevel: use the heuristic as a baseline; adjust based on what the changelog and codebase investigation say
- expectedBreakingChanges: only include API changes that actually affect this codebase
- knownIssues: bugs or regressions in the target version the reviewer should know about`;

export class CopilotResearcherAdapter implements ResearchLlmPort {
  constructor(private chatCompletion: ToolUseChatCompletionPort) {}

  async synthesise(
    target: UpgradeTarget,
    research: RawResearch,
    toolExecutor?: ToolExecutor
  ): Promise<UpgradePlan> {
    const userMessage = this.buildUserMessage(target, research);

    try {
      if (toolExecutor) {
        return await this.synthesiseWithTools(target, userMessage, toolExecutor);
      }
      return await this.synthesiseJson(target, userMessage);
    } catch (err) {
      console.error("[copilot-researcher] Failed to get/parse LLM response:", err);
      return {
        target,
        riskLevel: deriveRiskLevel(target.fromVersion, target.toVersion),
        shouldProceed: true,
        expectedBreakingChanges: [],
        knownIssues: ["Research synthesis failed — review diff carefully."],
        researchSummary: "Could not synthesise research (LLM parse error).",
      };
    }
  }

  private async synthesiseJson(
    target: UpgradeTarget,
    userMessage: string
  ): Promise<UpgradePlan> {
    const parsed = await this.chatCompletion.completeJson<RawPlan>([
      { role: "system", content: SYNTHESIS_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return this.coerceResponse(parsed, target);
  }

  private async synthesiseWithTools(
    target: UpgradeTarget,
    userMessage: string,
    toolExecutor: ToolExecutor
  ): Promise<UpgradePlan> {
    // Phase 1: use tools to gather codebase findings as plain text
    const findings = await this.chatCompletion.completeWithTools(
      [
        { role: "system", content: INVESTIGATION_PROMPT },
        { role: "user", content: userMessage },
      ],
      RESEARCHER_TOOLS,
      toolExecutor,
      { maxTurns: 20 }
    );

    // Phase 2: synthesise research + findings into structured JSON
    const synthesisMessage = findings
      ? `${userMessage}\n\n## Codebase Investigation Findings\n${findings}`
      : userMessage;

    const parsed = await this.chatCompletion.completeJson<RawPlan>([
      { role: "system", content: SYNTHESIS_PROMPT },
      { role: "user", content: synthesisMessage },
    ]);

    return this.coerceResponse(parsed, target);
  }

  private buildUserMessage(target: UpgradeTarget, research: RawResearch): string {
    const sections: string[] = [];
    const heuristicRisk = deriveRiskLevel(target.fromVersion, target.toVersion);

    sections.push(
      `## Upgrade: ${target.packageName} ${target.fromVersion} → ${target.toVersion}`,
      `**Heuristic risk estimate:** ${heuristicRisk}`
    );

    if (research.pastLessons.length > 0) {
      const lessonText = research.pastLessons
        .map((l) => `- Problem: ${l.problem}\n  Solution: ${l.solution}`)
        .join("\n");
      sections.push(`## Past Lessons from Memory\n${lessonText}`);
    }

    if (research.changelog) {
      const maxLen = 8000;
      const truncated = research.changelog.length > maxLen;
      const text = truncated ? research.changelog.slice(0, maxLen) : research.changelog;
      const notice = truncated ? `\n\n*(truncated — ${research.changelog.length} chars total, showing first ${maxLen})*` : "";
      sections.push(`## Changelog\n\`\`\`\n${text}\n\`\`\`${notice}`);
    }

    if (research.githubIssues && research.githubIssues.length > 0) {
      const issues = research.githubIssues
        .slice(0, 10)
        .map((issue) => {
          const labels = issue.labels.length > 0 ? ` [${issue.labels.join(", ")}]` : "";
          const body = issue.body.length > 2000 ? issue.body.slice(0, 2000) + "…" : issue.body;
          return `### ${issue.title}${labels}\n${issue.url} (${issue.state})\n${body}`;
        })
        .join("\n\n");
      sections.push(`## GitHub Issues\n${issues}`);
    }

    if (research.codebaseAnalysis) {
      const a = research.codebaseAnalysis;
      const lines: string[] = [
        `## Codebase Usage`,
        `- **Files using this package:** ${a.fileCount}`,
        `- **Total usage sites:** ${a.usageCount}`,
        `- **Wrapped in abstraction:** ${a.isWrapped ? "yes" : "no"}`,
        `- **Summary:** ${a.usageSummary}`,
      ];
      if (a.riskyPatterns.length > 0) {
        lines.push(`- **Risky patterns:** ${a.riskyPatterns.join("; ")}`);
      }
      if (a.usageSites.length > 0) {
        const snippets = a.usageSites
          .slice(0, 5)
          .map((s) => `### ${s.filePath}\n\`\`\`\n${s.snippet}\n\`\`\``)
          .join("\n\n");
        lines.push(`\n### Sample Usage\n${snippets}`);
      }
      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }

  private coerceResponse(
    parsed: {
      riskLevel?: string;
      shouldProceed?: boolean;
      expectedBreakingChanges?: Array<{ description?: string; apiPattern?: string; suggestedFix?: string }>;
      knownIssues?: string[];
      researchSummary?: string;
    },
    target: UpgradeTarget
  ): UpgradePlan {
    const validRiskLevels = new Set<RiskLevel>(["low", "medium", "high", "critical"]);
    const riskLevel: RiskLevel = validRiskLevels.has(parsed.riskLevel as RiskLevel)
      ? (parsed.riskLevel as RiskLevel)
      : deriveRiskLevel(target.fromVersion, target.toVersion);

    const expectedBreakingChanges: ExpectedBreakingChange[] = (
      parsed.expectedBreakingChanges ?? []
    ).map((c) => ({
      description: c.description ?? "Unknown change",
      apiPattern: c.apiPattern,
      suggestedFix: c.suggestedFix,
    }));

    return {
      target,
      riskLevel,
      shouldProceed: parsed.shouldProceed ?? true,
      expectedBreakingChanges,
      knownIssues: parsed.knownIssues ?? [],
      researchSummary: parsed.researchSummary ?? "No research summary provided.",
    };
  }
}
