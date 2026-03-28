import type { ChatCompletionPort } from "@tilsley/shared";
import type { DocAnalyzerLlmPort } from "../../application/ports/doc-analyzer-llm.port";
import type { DocClaim } from "../../domain/entities/doc-claim";

const SYSTEM_PROMPT = `You are a documentation analyst. Your job is to extract every factual claim from a documentation file.

A "claim" is any statement that asserts something concrete and verifiable about the project:
- How to install or set up the project
- Commands to run (scripts, CLI, etc.)
- Environment variables required
- File paths or directory structure references
- Architecture or design patterns used
- API endpoints or interfaces
- Deployment instructions
- Configuration options

Do NOT extract:
- Subjective opinions ("this is a great library")
- Generic boilerplate ("contributions welcome")
- License information
- Badges or shields

For each claim, identify:
- The section heading it appears under
- The exact claim text (paraphrased to a single factual statement)
- A category: "setup", "usage", "config", "architecture", "api", "deployment", or "other"
- The source text from the doc (the actual markdown snippet containing the claim)

Respond ONLY with valid JSON:
{
  "claims": [
    {
      "section": "Getting Started",
      "claim": "Run npm install to install dependencies",
      "category": "setup",
      "sourceText": "## Getting Started\\n\\nRun \`npm install\` to install..."
    }
  ]
}`;

export class CopilotDocAnalyzerAdapter implements DocAnalyzerLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async extractClaims(docContent: string, filePath: string): Promise<DocClaim[]> {
    const userPrompt = `Extract all factual claims from this documentation file.

File: ${filePath}

\`\`\`markdown
${docContent}
\`\`\``;

    try {
      const result = await this.chat.completeJson<{
        claims: Array<{
          section?: string;
          claim?: string;
          category?: string;
          sourceText?: string;
        }>;
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      return (result.claims ?? [])
        .filter((c) => c.claim && c.section)
        .map((c) => ({
          section: c.section!,
          claim: c.claim!,
          category: validateCategory(c.category),
          sourceText: c.sourceText ?? "",
        }));
    } catch (err) {
      console.error("[doc-analyzer] Failed to extract claims:", err);
      return [];
    }
  }
}

function validateCategory(
  cat?: string
): DocClaim["category"] {
  const valid = ["setup", "usage", "config", "architecture", "api", "deployment", "other"];
  return valid.includes(cat ?? "") ? (cat as DocClaim["category"]) : "other";
}
