import type { ChatCompletionPort, Lesson } from "@tilsley/shared";
import type { ConsolidatorLlmPort, ConsolidationResult } from "../../application/ports/consolidator-llm.port";

const SYSTEM_PROMPT = `You are a knowledge curator managing a two-tier lesson memory store for a CI/CD pipeline.

Lessons are stored in two tiers:
- **repo**: lessons specific to a particular codebase (its setup, config, dependencies, frameworks, file structure)
- **global**: universally applicable lessons about process, strategy, or automation patterns that apply across any repo

Given existing memory (repo tier and global tier) and new incoming lessons from a recent pipeline run, produce a consolidated result for both tiers.

Rules for consolidation:
- MERGE lessons that cover the same problem into a single richer lesson
- STRENGTHEN lessons confirmed by new evidence
- SUPERSEDE lessons where new evidence contradicts or improves on the old one
- ADD genuinely new lessons not covered by existing memory
- PRESERVE lessons unrelated to the incoming batch exactly as they are
- DROP near-duplicate lessons, keeping the most informative version

Rules for categorisation of incoming lessons:
- repo: lessons about specific files, config patterns, frameworks, or environment setup for this codebase (e.g. "this project requires aws-exports.js", "the lockfile must be v1")
- global: lessons about process or strategy that would apply to any repo (e.g. "never downgrade major versions", "scope patch PRs to one package")

Respond ONLY with valid JSON in this exact shape:
{"repo": [...lesson objects...], "global": [...lesson objects...]}

Each lesson object: {"problem": "...", "solution": "...", "context": "...", "outcome": "...", "tags": ["..."], "metadata": {}}

The output represents the entire memory going forward. Be conservative — do not drop lessons unless clearly superseded or duplicate.`;

export class CopilotConsolidatorAdapter implements ConsolidatorLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async consolidate(
    existing: { repo: Lesson[]; global: Lesson[] },
    incoming: Lesson[]
  ): Promise<ConsolidationResult> {
    const userMessage = this.buildUserMessage(existing, incoming);

    const response = await this.chatCompletion.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ]);

    return this.parseResponse(response);
  }

  private buildUserMessage(
    existing: { repo: Lesson[]; global: Lesson[] },
    incoming: Lesson[]
  ): string {
    const sections: string[] = [];

    sections.push("## Existing Repo-Specific Memory");
    sections.push(existing.repo.length > 0 ? JSON.stringify(existing.repo, null, 2) : "(empty)");

    sections.push("## Existing Global Memory");
    sections.push(existing.global.length > 0 ? JSON.stringify(existing.global, null, 2) : "(empty)");

    sections.push("## Incoming Lessons from This Pipeline Run");
    sections.push(JSON.stringify(incoming, null, 2));

    return sections.join("\n\n");
  }

  private parseResponse(content: string): ConsolidationResult {
    try {
      const objectMatch = content.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        const parsed = JSON.parse(objectMatch[0]) as {
          repo?: unknown[];
          global?: unknown[];
        };

        return {
          repo: this.parseLessons(parsed.repo ?? []),
          global: this.parseLessons(parsed.global ?? []),
        };
      }

      throw new Error("No JSON object found in response");
    } catch (err) {
      console.error("[copilot-consolidator] Failed to parse response:", content, err);
      return { repo: [], global: [] };
    }
  }

  private parseLessons(items: unknown[]): Lesson[] {
    return items.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        problem: (i["problem"] as string) ?? "",
        solution: (i["solution"] as string) ?? "",
        context: (i["context"] as string) ?? "",
        outcome: (i["outcome"] as string) ?? "",
        tags: (i["tags"] as string[]) ?? [],
        metadata: (i["metadata"] as Record<string, unknown>) ?? {},
      };
    });
  }
}
