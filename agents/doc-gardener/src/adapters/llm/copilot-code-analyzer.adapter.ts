import type { ChatCompletionPort } from "@tilsley/shared";
import type {
  CodeAnalyzerLlmPort,
  SourceFile,
} from "../../application/ports/code-analyzer-llm.port";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";

const SYSTEM_PROMPT = `You are a code analyst. Your job is to read source files from a repository and produce a structured summary of the project's actual behaviour.

Given source files and a repo inventory (package.json scripts, env vars, config files), produce:
- entryPoints: files that serve as the main entry point(s) and their purpose
- scripts: package.json scripts with what they actually do
- envVars: environment variables actually used in code (name, which file uses them, purpose)
- architecturalFacts: key facts about the project structure/patterns (e.g. "uses Express for HTTP", "hexagonal architecture with ports/adapters")
- configSummary: notable config files and their role
- summary: 2-3 sentence overview of what the project does and how

Focus on FACTS. Do not speculate. If you cannot determine something from the code, omit it.

Respond ONLY with valid JSON:
{
  "entryPoints": [{ "file": "src/main.ts", "purpose": "HTTP server entry point" }],
  "scripts": [{ "name": "dev", "command": "bun run src/main.ts", "purpose": "starts dev server" }],
  "envVars": [{ "name": "PORT", "usedIn": "src/main.ts", "purpose": "HTTP port" }],
  "architecturalFacts": ["Uses Hono for HTTP routing", "Hexagonal architecture"],
  "configSummary": [{ "file": "tsconfig.json", "role": "TypeScript compiler configuration" }],
  "summary": "A webhook server that..."
}`;

export class CopilotCodeAnalyzerAdapter implements CodeAnalyzerLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async analyzeCode(
    sourceFiles: SourceFile[],
    inventory: RepoInventory
  ): Promise<CodeSnapshot> {
    const fileSections = sourceFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
      .join("\n\n");

    const inventorySummary = [
      `**Scripts:** ${JSON.stringify(inventory.scripts)}`,
      `**Env vars (.env.example):** ${inventory.envVars.join(", ") || "none"}`,
      `**Config files:** ${inventory.configFiles.join(", ") || "none"}`,
      `**Total files:** ${inventory.allFiles.length}`,
    ].join("\n");

    const userPrompt = `Analyze these source files and produce a structured code snapshot.

## Repository Inventory
${inventorySummary}

## Source Files (${sourceFiles.length} files)
${fileSections}`;

    try {
      const result = await this.chat.completeJson<{
        entryPoints?: Array<{ file?: string; purpose?: string }>;
        scripts?: Array<{ name?: string; command?: string; purpose?: string }>;
        envVars?: Array<{ name?: string; usedIn?: string; purpose?: string }>;
        architecturalFacts?: string[];
        configSummary?: Array<{ file?: string; role?: string }>;
        summary?: string;
      }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ]);

      return {
        entryPoints: (result.entryPoints ?? [])
          .filter((e) => e.file)
          .map((e) => ({ file: e.file!, purpose: e.purpose ?? "" })),
        scripts: (result.scripts ?? [])
          .filter((s) => s.name)
          .map((s) => ({
            name: s.name!,
            command: s.command ?? "",
            purpose: s.purpose ?? "",
          })),
        envVars: (result.envVars ?? [])
          .filter((v) => v.name)
          .map((v) => ({
            name: v.name!,
            usedIn: v.usedIn ?? "",
            purpose: v.purpose ?? "",
          })),
        architecturalFacts: result.architecturalFacts ?? [],
        configSummary: (result.configSummary ?? [])
          .filter((c) => c.file)
          .map((c) => ({ file: c.file!, role: c.role ?? "" })),
        summary: result.summary ?? "No summary available.",
      };
    } catch (err) {
      console.error("[code-analyzer] Failed to analyze code:", err);
      return {
        entryPoints: [],
        scripts: Object.entries(inventory.scripts).map(([name, command]) => ({
          name,
          command,
          purpose: "",
        })),
        envVars: inventory.envVars.map((name) => ({
          name,
          usedIn: "",
          purpose: "",
        })),
        architecturalFacts: [],
        configSummary: [],
        summary: "Code analysis failed (LLM error).",
      };
    }
  }
}
