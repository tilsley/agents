import type { ChatCompletionPort, PolicyRule } from "@tilsley/shared";
import type { DocPlannerLlmPort } from "../../application/ports/doc-planner-llm.port";
import type { DocClaim } from "../../domain/entities/doc-claim";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { DriftItem } from "../../domain/entities/drift-report";
import type { DocUpdatePlan, FixItem } from "../../domain/entities/doc-update-plan";

const SYSTEM_PROMPT = `You are a documentation planner. Your job is to compare factual claims extracted from documentation against what the code actually does, then produce a prioritized fix list.

You receive:
1. Claims extracted from the current documentation
2. A code snapshot summarizing the project's actual behaviour
3. Deterministic drift items (already detected by string matching)
4. Policy rules (constraints you must respect)
5. The current documentation content

Your job:
- Identify semantic drift: claims that are factually WRONG based on the code (not just missing info)
- Merge semantic drift with the deterministic drift items
- Produce a prioritized list of fixes

For each fix, specify:
- The drift item it addresses (include all DriftItem fields)
- An action: "rewrite-section", "add-section", "remove-claim", "update-claim", or "create-file"
- The target file and section
- A clear description of what the writer should do
- A priority (1 = highest)

Set giveUp to true ONLY if the documentation is so fundamentally wrong that incremental fixes won't help (extremely rare).

Respond ONLY with valid JSON:
{
  "driftItems": [
    {
      "file": "README.md",
      "section": "Usage",
      "driftType": "semantic-drift",
      "severity": "high",
      "detail": "README says to run 'npm start' but package.json uses 'bun run dev'",
      "source": "llm",
      "claim": "Run npm start to launch the server",
      "codeEvidence": "package.json scripts: { dev: 'bun run src/main.ts' }",
      "confidence": 0.9,
      "reasoning": "The README references npm start but the project uses bun"
    }
  ],
  "fixes": [
    {
      "drift": { ... },
      "action": "update-claim",
      "file": "README.md",
      "section": "Usage",
      "description": "Replace 'npm start' with 'bun run dev' in the usage section",
      "priority": 1
    }
  ],
  "giveUp": false,
  "planReasoning": "Found 2 semantic drift items and 3 deterministic drift items. The README has outdated setup instructions."
}`;

export class CopilotDocPlannerAdapter implements DocPlannerLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async analyzeGapsAndPlan(input: {
    claims: DocClaim[];
    codeSnapshot: CodeSnapshot;
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string;
    repo: string;
  }): Promise<DocUpdatePlan> {
    const userPrompt = this.buildUserPrompt(input);

    try {
      const result = await this.chat.completeJson<{
        driftItems?: Array<Partial<DriftItem>>;
        fixes?: Array<{
          drift?: Partial<DriftItem>;
          action?: string;
          file?: string;
          section?: string;
          description?: string;
          priority?: number;
        }>;
        giveUp?: boolean;
        planReasoning?: string;
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      const semanticDrift: DriftItem[] = (result.driftItems ?? [])
        .filter((d) => d.driftType === "semantic-drift")
        .map((d) => ({
          file: d.file ?? "README.md",
          section: d.section,
          driftType: "semantic-drift" as const,
          severity: d.severity ?? "medium",
          detail: d.detail ?? "Semantic drift detected",
          source: "llm" as const,
          claim: d.claim,
          codeEvidence: d.codeEvidence,
          confidence: d.confidence,
          reasoning: d.reasoning,
        }));

      const allDrift = [...input.deterministicDrift, ...semanticDrift];

      const fixes: FixItem[] = (result.fixes ?? [])
        .filter((f) => f.action && f.file && f.description)
        .map((f) => ({
          drift: this.coerceDriftItem(f.drift),
          action: validateAction(f.action!),
          file: f.file!,
          section: f.section,
          description: f.description!,
          priority: f.priority ?? 99,
        }))
        .sort((a, b) => a.priority - b.priority);

      return {
        repo: input.repo,
        driftItems: allDrift,
        policyRules: input.policyRules,
        fixes,
        giveUp: result.giveUp ?? false,
        planReasoning: result.planReasoning ?? "",
      };
    } catch (err) {
      console.error("[doc-planner] Failed to produce plan:", err);
      // Fallback: wrap deterministic drift into simple fixes
      return {
        repo: input.repo,
        driftItems: input.deterministicDrift,
        policyRules: input.policyRules,
        fixes: input.deterministicDrift.map((d, i) => ({
          drift: d,
          action: "update-claim" as const,
          file: d.file,
          section: d.section,
          description: d.detail,
          priority: i + 1,
        })),
        giveUp: false,
        planReasoning: "Planner LLM call failed; falling back to deterministic drift only.",
      };
    }
  }

  private buildUserPrompt(input: {
    claims: DocClaim[];
    codeSnapshot: CodeSnapshot;
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string;
    repo: string;
  }): string {
    const sections: string[] = [];

    sections.push(`## Repository: ${input.repo}`);

    // Claims
    if (input.claims.length > 0) {
      const claimList = input.claims
        .map(
          (c) =>
            `- [${c.category}] **${c.section}**: ${c.claim}`
        )
        .join("\n");
      sections.push(`## Documentation Claims (${input.claims.length})\n${claimList}`);
    } else {
      sections.push("## Documentation Claims\nNo claims extracted (doc may be empty or missing).");
    }

    // Code snapshot
    sections.push(`## Code Snapshot\n${JSON.stringify(input.codeSnapshot, null, 2)}`);

    // Deterministic drift
    if (input.deterministicDrift.length > 0) {
      const driftList = input.deterministicDrift
        .map((d) => `- [${d.severity}] ${d.driftType}: ${d.detail}`)
        .join("\n");
      sections.push(`## Deterministic Drift (${input.deterministicDrift.length} items)\n${driftList}`);
    }

    // Policy rules
    if (input.policyRules.length > 0) {
      const ruleList = input.policyRules.map((r) => `- ${r.rule}`).join("\n");
      sections.push(`## Policy Rules\n${ruleList}`);
    }

    // Current doc
    if (input.currentDoc) {
      sections.push(
        `## Current Documentation\n\`\`\`markdown\n${input.currentDoc}\n\`\`\``
      );
    } else {
      sections.push("## Current Documentation\nNo documentation exists.");
    }

    return sections.join("\n\n");
  }

  private coerceDriftItem(d?: Partial<DriftItem>): DriftItem {
    return {
      file: d?.file ?? "README.md",
      section: d?.section,
      driftType: d?.driftType ?? "semantic-drift",
      severity: d?.severity ?? "medium",
      detail: d?.detail ?? "Unknown drift",
      source: d?.source ?? "llm",
      claim: d?.claim,
      codeEvidence: d?.codeEvidence,
      confidence: d?.confidence,
      reasoning: d?.reasoning,
    };
  }
}

function validateAction(
  action: string
): FixItem["action"] {
  const valid = [
    "rewrite-section",
    "add-section",
    "remove-claim",
    "update-claim",
    "create-file",
  ];
  return valid.includes(action)
    ? (action as FixItem["action"])
    : "update-claim";
}
