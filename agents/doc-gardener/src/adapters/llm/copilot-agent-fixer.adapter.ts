import type { AgentSessionPort, PolicyRule, RepoTemplate } from "@tilsley/shared";
import type { AgentFixerLlmPort } from "../../application/ports/agent-fixer-llm.port";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";
import type { DriftItem } from "../../domain/entities/drift-report";

const SYSTEM_PROMPT = `You are a documentation fixer agent. You have access to the repository via built-in tools: view (read files), glob (find files), and edit (edit files).

Your job:
1. Review the provided documentation files and inventory
2. Explore the source code using view and glob to understand what the project actually does
3. Compare the documentation against the code — find claims that are wrong, missing, or stale
4. Fix any documentation files directly using edit
5. Return a JSON summary of the drift you found and fixed

Guidelines:
- Fix factual inaccuracies (wrong commands, missing scripts, outdated descriptions)
- Add missing sections for undocumented scripts, env vars, and configs
- Remove or correct stale references to files/features that no longer exist
- Respect all policy rules provided
- Preserve the overall structure and tone of the existing documentation
- Do NOT invent features or capabilities not evidenced in the source code
- If no documentation exists, create a reasonable README from scratch using the create tool
- Use view to inspect source files before making claims about what the code does
- Use glob to discover project structure when needed
- If a Repository Template is provided, treat it as a structural checklist. Ensure every required file exists with required sections and constraints satisfied. Create missing files using the create tool.

After making all edits, respond with ONLY valid JSON (no markdown fences):
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
  "planReasoning": "Found 2 semantic drift items. Fixed setup instructions and added missing env var documentation."
}

Do NOT include files in the response — you edit them directly via the edit tool.`;

export class CopilotAgentFixerAdapter implements AgentFixerLlmPort {
  constructor(private agentSession: AgentSessionPort) {}

  async fix(input: {
    workDir: string;
    inventory: RepoInventory;
    docFiles: Array<{ path: string; content: string }>;
    policyRules: PolicyRule[];
    repo: string;
    template?: RepoTemplate;
  }): Promise<{
    driftItems: DriftItem[];
    planReasoning: string;
  }> {
    const userPrompt = this.buildUserPrompt(input);

    let responseText: string;
    try {
      responseText = await this.agentSession.runAgentSession({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        workingDirectory: input.workDir,
        availableTools: ["view", "glob", "edit", "create"],
      });
    } catch (err) {
      console.warn(
        `[agent-fixer] Agent session failed: ${err instanceof Error ? err.message : err}`
      );
      return {
        driftItems: [],
        planReasoning: "Agent session failed; no fixes produced.",
      };
    }

    let result: {
      driftItems?: Array<Partial<DriftItem>>;
      planReasoning?: string;
    };

    try {
      result = extractJson(responseText);
    } catch (err) {
      console.warn(
        `[agent-fixer] Failed to parse JSON from agent response: ${err instanceof Error ? err.message : err}`
      );
      return {
        driftItems: [],
        planReasoning: "Agent session completed but returned invalid JSON; edits may still be on disk.",
      };
    }

    const driftItems: DriftItem[] = (result.driftItems ?? [])
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

    return {
      driftItems,
      planReasoning: result.planReasoning ?? "",
    };
  }

  private buildUserPrompt(input: {
    inventory: RepoInventory;
    docFiles: Array<{ path: string; content: string }>;
    policyRules: PolicyRule[];
    repo: string;
    template?: RepoTemplate;
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

    // Full file listing
    sections.push(`## File Listing`);
    sections.push("```");
    sections.push(inv.allFiles.join("\n"));
    sections.push("```");

    // Documentation files (pre-loaded)
    if (input.docFiles.length > 0) {
      sections.push(`## Documentation Files (${input.docFiles.length})`);
      for (const f of input.docFiles) {
        sections.push(`### ${f.path}\n\`\`\`markdown\n${f.content}\n\`\`\``);
      }
    } else {
      sections.push(
        "## Documentation Files\nNo .md files found. Create a README.md from scratch."
      );
    }

    // Policy rules
    if (input.policyRules.length > 0) {
      const ruleList = input.policyRules.map((r) => `- ${r.rule}`).join("\n");
      sections.push(`## Policy Rules (must respect)\n${ruleList}`);
    }

    // Repository template
    if (input.template) {
      sections.push(this.renderTemplate(input.template));
    }

    sections.push(
      "\n## Instructions\nExplore the source code using view and glob to understand what the project actually does. Compare against the documentation, fix any drift using edit, then return the JSON summary."
    );

    return sections.join("\n\n");
  }

  private renderTemplate(template: RepoTemplate): string {
    const lines: string[] = [];
    lines.push(`## Repository Template: ${template.name} (structural requirements)`);
    lines.push("Check each requirement and create/update files as needed.");
    lines.push("");
    lines.push("### Required Files");

    for (let i = 0; i < template.files.length; i++) {
      const f = template.files[i];
      lines.push(`\n${i + 1}. **${f.path}** (${f.required ? "required" : "optional"})`);

      if (f.sections && f.sections.length > 0) {
        const requiredSections = f.sections.filter((s) => s.required);
        if (requiredSections.length > 0) {
          lines.push(`   - Required sections: ${requiredSections.map((s) => s.heading).join(", ")}`);
        }
        const withHints = f.sections.filter((s) => s.description);
        if (withHints.length > 0) {
          lines.push("   - Section hints:");
          for (const s of withHints) {
            lines.push(`     - ${s.heading}: ${s.description}`);
          }
        }
      }

      if (f.constraints && f.constraints.length > 0) {
        lines.push(`   - Constraints: ${f.constraints.join("; ")}`);
      }
    }

    if (template.directories && template.directories.length > 0) {
      lines.push("");
      lines.push("### Directories");
      for (const d of template.directories) {
        lines.push(`\n- **${d.path}/** (${d.required ? "required" : "validate if present"})`);
        if (d.filePattern) {
          lines.push(`  - Expected files matching: ${d.filePattern}`);
        }
        if (d.formatDescription) {
          lines.push(`  - Format: ${d.formatDescription}`);
        }
      }
    }

    return lines.join("\n");
  }
}

/** Try direct parse first; fall back to regex extraction. */
function extractJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new SyntaxError("No JSON object found in response");
    return JSON.parse(match[0]) as T;
  }
}
