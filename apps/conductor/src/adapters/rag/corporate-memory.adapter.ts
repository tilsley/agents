import type { RagPort, RagDocument, Lesson } from "@tilsley/shared";
import type { CorporateMemoryPort } from "../../../../agents/review-agent/src/application/ports/corporate-memory.port";

export class CorporateMemoryAdapter implements CorporateMemoryPort {
  constructor(private rag: RagPort) {}

  async findRelevantLessons(query: string, taskType: string): Promise<Lesson[]> {
    const docs = await this.rag.query(query, {
      limit: 5,
      filter: { type: "lesson" },
    });
    return docs.map(docToLesson);
  }

  async findPastReviews(repo: string, taskType: string): Promise<string[]> {
    const docs = await this.rag.query(`${repo} ${taskType}`, {
      limit: 3,
      filter: { type: "review_feedback" },
    });
    return docs.map((d) => d.content);
  }
}

function docToLesson(doc: RagDocument): Lesson {
  return {
    problem:
      typeof doc.metadata.problem === "string"
        ? doc.metadata.problem
        : extractField(doc.content, "Problem"),
    solution:
      typeof doc.metadata.solution === "string"
        ? doc.metadata.solution
        : extractField(doc.content, "Solution"),
    context: extractField(doc.content, "Context"),
    outcome: extractField(doc.content, "Outcome"),
    tags: Array.isArray(doc.metadata.tags)
      ? (doc.metadata.tags as string[])
      : [],
    metadata: doc.metadata,
  };
}

function extractField(content: string, field: string): string {
  const match = content.match(new RegExp(`${field}: (.+)`));
  return match?.[1]?.trim() ?? "";
}
