import type { Lesson } from "@tilsley/shared";

export interface KnowledgePort {
  findRelevantLessons(query: string, taskType: string, agentId?: string, repoName?: string): Promise<Lesson[]>;
  findPastReviews(repo: string, taskType: string): Promise<string[]>;
}
