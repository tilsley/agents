import { describe, expect, test } from "bun:test";
import {
  filterByRelevance,
  hasMinimumContext,
} from "../../src/domain/policies/relevance-policy";
import type { MemoryDocument } from "@tilsley/shared";

function makeDoc(
  id: string,
  relevanceScore: number = 0.8
): MemoryDocument {
  return {
    id,
    content: `Document ${id} content`,
    metadata: { relevanceScore },
  };
}

describe("filterByRelevance", () => {
  test("filters out low relevance documents", () => {
    const docs = [makeDoc("a", 0.9), makeDoc("b", 0.3), makeDoc("c", 0.7)];
    const result = filterByRelevance(docs, { threshold: 0.5 });
    expect(result).toHaveLength(2);
    expect(result.map((d) => d.id)).toEqual(["a", "c"]);
  });

  test("limits results to maxResults", () => {
    const docs = Array.from({ length: 10 }, (_, i) => makeDoc(`doc-${i}`, 0.9));
    const result = filterByRelevance(docs, { maxResults: 3 });
    expect(result).toHaveLength(3);
  });

  test("uses default threshold of 0.5", () => {
    const docs = [makeDoc("high", 0.8), makeDoc("low", 0.3)];
    const result = filterByRelevance(docs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("high");
  });

  test("returns empty array when no docs meet threshold", () => {
    const docs = [makeDoc("a", 0.1), makeDoc("b", 0.2)];
    const result = filterByRelevance(docs, { threshold: 0.5 });
    expect(result).toHaveLength(0);
  });

  test("treats missing relevanceScore as 1", () => {
    const doc: MemoryDocument = { id: "x", content: "test", metadata: {} };
    const result = filterByRelevance([doc], { threshold: 0.5 });
    expect(result).toHaveLength(1);
  });
});

describe("hasMinimumContext", () => {
  test("returns true when enough documents", () => {
    expect(hasMinimumContext([makeDoc("a")], 1)).toBe(true);
  });

  test("returns false when not enough documents", () => {
    expect(hasMinimumContext([], 1)).toBe(false);
  });

  test("defaults to minimum count of 1", () => {
    expect(hasMinimumContext([makeDoc("a")])).toBe(true);
    expect(hasMinimumContext([])).toBe(false);
  });
});
