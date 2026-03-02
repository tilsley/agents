import type { MemoryDocument } from "@tilsley/shared";

const DEFAULT_RELEVANCE_THRESHOLD = 0.5;
const DEFAULT_MAX_RESULTS = 5;

export interface RelevanceFilterOptions {
  threshold?: number;
  maxResults?: number;
}

export function filterByRelevance(
  documents: MemoryDocument[],
  options: RelevanceFilterOptions = {}
): MemoryDocument[] {
  const {
    threshold = DEFAULT_RELEVANCE_THRESHOLD,
    maxResults = DEFAULT_MAX_RESULTS,
  } = options;

  return documents
    .filter((doc) => {
      const score = (doc.metadata.relevanceScore as number) ?? 1;
      return score >= threshold;
    })
    .slice(0, maxResults);
}

export function hasMinimumContext(
  documents: MemoryDocument[],
  minCount: number = 1
): boolean {
  return documents.length >= minCount;
}
