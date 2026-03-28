import type { ChatCompletionPort, PolicyRule } from "@tilsley/shared";
import type { SinglePassFixerLlmPort } from "../../application/ports/single-pass-fixer-llm.port";
import type { SourceFile } from "../../application/ports/code-analyzer-llm.port";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";
import type { DriftItem } from "../../domain/entities/drift-report";

const SYSTEM_PROMPT = `You are a documentation fixer. You receive a complete picture of a repository — its file inventory, source code, existing documentation, deterministic drift items, and policy rules — and you must produce corrected documentation files in a single pass.

Your job:
1. Analyze the existing README for factual claims about the project
2. Analyze the source code to understand what the project actually does
3. Compare claims vs code to find semantic drift (claims that are factually wrong)
4. Merge semantic drift with the provided deterministic drift items
5. Produce corrected documentation files that fix all drift

Guidelines:
- Fix factual inaccuracies (wrong commands, missing scripts, outdated descriptions)
- Add missing sections for undocumented scripts, env vars, and configs
- Remove or correct stale references to files/features that no longer exist
- Respect all policy rules provided
- Preserve the overall structure and tone of the existing documentation
- Do NOT invent features or capabilities not evidenced in the source code
- If no documentation exists, create a reasonable README from scratch

Respond ONLY with valid JSON:
{
  "driftItems": [
    {
      "file": "README.md",
      "section": "Usage",
      "driftType": "semantic-drift",
      "severity": "high",
      "detail": "README says 'npm start' but project uses 'bun run dev'",
      "source": "llm",
      "claim": "Run npm start to launch the server",
      "codeEvidence": "package.json scripts: { dev: 'bun run src/main.ts' }",
      "confidence": 0.9,
      "reasoning": "The README references npm start but the project uses bun"
    }
  ],
  "files": [
    {
      "file": "README.md",
      "content": "# Project Name\\n\\n..."
    }
  ],
  "planReasoning": "Found 2 semantic drift items. Fixed setup instructions and added missing env var documentation."
}

driftItems should contain ONLY semantic drift you discovered (source: "llm"). The deterministic items are already tracked separately.
The files array should contain the COMPLETE content of each file you want to create or update.`;

export class CopilotSinglePassFixerAdapter implements SinglePassFixerLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async fix(input: {
    inventory: RepoInventory;
    sourceFiles: SourceFile[];
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string | null;
    repo: string;
  }): Promise<{
    driftItems: DriftItem[];
    files: Array<{ file: string; content: string }>;
    planReasoning: string;
  }> {
    const userPrompt = this.buildUserPrompt(input);

    let result: {
      driftItems?: Array<Partial<DriftItem>>;
      files?: Array<{ file?: string; content?: string }>;
      planReasoning?: string;
    };

    try {
      result = await this.chat.completeJson<typeof result>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);
    } catch (err) {
      console.warn(
        `[single-pass-fixer] LLM returned invalid response (falling back to deterministic drift only): ${err instanceof Error ? err.message : err}`
      );
      return {
        driftItems: input.deterministicDrift,
        files: [],
        planReasoning: "Single-pass LLM call failed; deterministic drift reported but no fixes produced.",
      };
    }

    const semanticDrift: DriftItem[] = (result.driftItems ?? [])
      .filter((d) => d.detail)
      .map((d) => ({
        file: d.file ?? "README.md",
        section: d.section,
        driftType: d.driftType ?? "semantic-drift",
        severity: d.severity ?? "medium",
        detail: d.detail!,
        source: "llm" as const,
        claim: d.claim,
        codeEvidence: d.codeEvidence,
        confidence: d.confidence,
        reasoning: d.reasoning,
      }));

    const allDrift = [...input.deterministicDrift, ...semanticDrift];

    const files = (result.files ?? [])
      .filter((f) => f.file && f.content)
      .map((f) => ({ file: f.file!, content: f.content! }));

    return {
      driftItems: allDrift,
      files,
      planReasoning: result.planReasoning ?? "",
    };
  }

  private buildUserPrompt(input: {
    inventory: RepoInventory;
    sourceFiles: SourceFile[];
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string | null;
    repo: string;
  }): string {
    const sections: string[] = [];

    sections.push(`## Repository: ${input.repo}`);

    // Inventory summary
    const inv = input.inventory;
    sections.push(`## Inventory`);
    sections.push(`- Scripts: ${JSON.stringify(inv.scripts)}`);
    if (inv.envVars.length > 0) {
      sections.push(`- Env vars (.env.example): ${inv.envVars.join(", ")}`);
    }
    if (inv.configFiles.length > 0) {
      sections.push(`- Config files: ${inv.configFiles.join(", ")}`);
    }
    sections.push(`- Total files: ${inv.allFiles.length}`);

    // Source files
    if (input.sourceFiles.length > 0) {
      sections.push(`## Source Files (${input.sourceFiles.length})`);
      for (const f of input.sourceFiles) {
        sections.push(`### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
      }
    }

    // Deterministic drift
    if (input.deterministicDrift.length > 0) {
      const driftList = input.deterministicDrift
        .map((d) => `- [${d.severity}] ${d.driftType}: ${d.detail}`)
        .join("\n");
      sections.push(
        `## Deterministic Drift (${input.deterministicDrift.length} items)\n${driftList}`
      );
    }

    // Policy rules
    if (input.policyRules.length > 0) {
      const ruleList = input.policyRules.map((r) => `- ${r.rule}`).join("\n");
      sections.push(`## Policy Rules\n${ruleList}`);
    }

    // Current documentation
    if (input.currentDoc) {
      sections.push(
        `## Current Documentation\n\`\`\`markdown\n${input.currentDoc}\n\`\`\``
      );
    } else {
      sections.push(
        "## Current Documentation\nNo README.md exists. Create one from scratch."
      );
    }

    return sections.join("\n\n");
  }
}
