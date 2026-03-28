import type { ChatCompletionPort, PolicyRule } from "@tilsley/shared";
import type { DocWriterLlmPort } from "../../application/ports/doc-writer-llm.port";
import type { FixItem } from "../../domain/entities/doc-update-plan";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";

const SYSTEM_PROMPT = `You are a documentation writer for open-source projects. You apply a single targeted fix to a documentation file.

Rules:
- Write clear, concise documentation
- Use standard markdown formatting
- Preserve existing content and structure — only change what the fix requires
- Use code blocks for commands and file paths
- Use tables for structured data like environment variables
- Do not add promotional or unnecessary content
- Return the FULL file content (not just the changed section)

Respond ONLY with valid JSON:
{
  "file": "README.md",
  "content": "full updated file content...",
  "changeDescription": "Brief description of what was changed"
}`;

export class CopilotDocWriterAdapter implements DocWriterLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async applyFix(input: {
    fix: FixItem;
    currentContent: string | null;
    codeSnapshot: CodeSnapshot;
    policyRules: PolicyRule[];
  }): Promise<{ file: string; content: string; changeDescription: string }> {
    const policyConstraints =
      input.policyRules.length > 0
        ? `\n\nPolicy Rules (you MUST respect these):\n${input.policyRules.map((r) => `- ${r.rule}`).join("\n")}`
        : "";

    const fixDescription = [
      `**Action:** ${input.fix.action}`,
      `**File:** ${input.fix.file}`,
      input.fix.section ? `**Section:** ${input.fix.section}` : null,
      `**Description:** ${input.fix.description}`,
      `**Drift:** [${input.fix.drift.severity}] ${input.fix.drift.driftType}: ${input.fix.drift.detail}`,
    ]
      .filter(Boolean)
      .join("\n");

    const codeContext = `## Code Context
${input.codeSnapshot.summary}

Entry points: ${input.codeSnapshot.entryPoints.map((e) => `${e.file} (${e.purpose})`).join(", ") || "none"}
Scripts: ${input.codeSnapshot.scripts.map((s) => `${s.name}: ${s.command}`).join(", ") || "none"}
Env vars: ${input.codeSnapshot.envVars.map((v) => `${v.name} (${v.purpose})`).join(", ") || "none"}`;

    const userPrompt = `Apply this single fix to the documentation.

## Fix to Apply
${fixDescription}
${policyConstraints}

${codeContext}

## Current File Content
${input.currentContent ? `\`\`\`markdown\n${input.currentContent}\n\`\`\`` : `No file exists yet — create \`${input.fix.file}\` from scratch.`}

Apply ONLY this fix. Return the full updated file content.`;

    try {
      const result = await this.chat.completeJson<{
        file?: string;
        content?: string;
        changeDescription?: string;
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      return {
        file: result.file ?? input.fix.file,
        content: result.content ?? input.currentContent ?? "",
        changeDescription:
          result.changeDescription ?? input.fix.description,
      };
    } catch (err) {
      // Non-fatal — return current content unchanged so the agent can continue
      console.warn(
        `[doc-writer] Failed to apply fix (skipping): ${input.fix.description} — ${err instanceof Error ? err.message : err}`
      );
      return {
        file: input.fix.file,
        content: input.currentContent ?? "",
        changeDescription: `SKIPPED: ${input.fix.description} (LLM returned invalid response)`,
      };
    }
  }
}
