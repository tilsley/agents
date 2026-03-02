import type { MemoryPort, MemoryDocument, Lesson } from "@tilsley/shared";
import type { KnowledgePort } from "../../../../agents/review-agent/src/application/ports/knowledge.port";

export class KnowledgeAdapter implements KnowledgePort {
  constructor(private memory: MemoryPort) {}

  async findRelevantLessons(
    query: string,
    taskType: string,
    agentId?: string,
    repoName?: string
  ): Promise<Lesson[]> {
    if (agentId && repoName) {
      // Load from both agent/repo and agent/global paths
      const [repoDocs, globalDocs] = await Promise.all([
        this.memory.list({ filter: { agent: agentId, repo: repoName, type: "lesson" } }),
        this.memory.list({ filter: { agent: agentId, scope: "global", type: "lesson" } }),
      ]);
      return [...repoDocs, ...globalDocs].map(docToLesson);
    }

    // Fallback: flat lesson.md (backwards compat / unknown agent)
    const docs = await this.memory.list({ filter: { type: "lesson" } });
    return docs.map(docToLesson);
  }

  async findPastReviews(repo: string, taskType: string): Promise<string[]> {
    const docs = await this.memory.list({
      limit: 10,
      filter: { type: "review_feedback" },
    });
    return docs.map((d) => d.content);
  }
}

function docToLesson(doc: MemoryDocument): Lesson {
  return {
    problem: extractField(doc.content, "Problem"),
    solution: extractField(doc.content, "Solution"),
    context: extractField(doc.content, "Context"),
    outcome: extractField(doc.content, "Outcome"),
    tags: [],
    metadata: doc.metadata,
  };
}

function extractField(content: string, field: string): string {
  const match = content.match(new RegExp(`${field}: (.+)`));
  return match?.[1]?.trim() ?? "";
}
