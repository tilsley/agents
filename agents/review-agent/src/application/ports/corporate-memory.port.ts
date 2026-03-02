import type { Lesson, RagDocument } from "@tilsley/shared";

export interface CorporateMemoryPort {
  findRelevantLessons(query: string, taskType: string): Promise<Lesson[]>;
  findPastReviews(repo: string, taskType: string): Promise<string[]>;
}
