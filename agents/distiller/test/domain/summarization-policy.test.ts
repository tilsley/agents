import { describe, expect, test } from "bun:test";
import {
  shouldIncludeLesson,
  deduplicateLessons,
  getIncludedContext,
} from "../../src/domain/policies/summarization-policy";
import type { Lesson } from "@tilsley/shared";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    problem: "Flaky test in CI",
    solution: "Add retry logic",
    context: "CI pipeline",
    outcome: "Reduced flake rate",
    tags: ["ci", "testing"],
    metadata: {},
    ...overrides,
  };
}

describe("shouldIncludeLesson", () => {
  test("includes lesson with problem and solution", () => {
    expect(shouldIncludeLesson(makeLesson())).toBe(true);
  });

  test("excludes lesson with empty problem", () => {
    expect(shouldIncludeLesson(makeLesson({ problem: "" }))).toBe(false);
  });

  test("excludes lesson with whitespace-only problem", () => {
    expect(shouldIncludeLesson(makeLesson({ problem: "   " }))).toBe(false);
  });

  test("excludes lesson with empty solution", () => {
    expect(shouldIncludeLesson(makeLesson({ solution: "" }))).toBe(false);
  });

  test("includes lesson with empty context", () => {
    expect(shouldIncludeLesson(makeLesson({ context: "" }))).toBe(true);
  });

  test("includes lesson with empty outcome", () => {
    expect(shouldIncludeLesson(makeLesson({ outcome: "" }))).toBe(true);
  });
});

describe("deduplicateLessons", () => {
  test("removes exact duplicates", () => {
    const lessons = [makeLesson(), makeLesson()];
    expect(deduplicateLessons(lessons)).toHaveLength(1);
  });

  test("keeps unique lessons", () => {
    const lessons = [
      makeLesson({ problem: "Problem A" }),
      makeLesson({ problem: "Problem B" }),
    ];
    expect(deduplicateLessons(lessons)).toHaveLength(2);
  });

  test("deduplicates case-insensitively", () => {
    const lessons = [
      makeLesson({ problem: "Flaky Test" }),
      makeLesson({ problem: "flaky test" }),
    ];
    expect(deduplicateLessons(lessons)).toHaveLength(1);
  });

  test("considers both problem and solution for dedup", () => {
    const lessons = [
      makeLesson({ problem: "Same problem", solution: "Solution A" }),
      makeLesson({ problem: "Same problem", solution: "Solution B" }),
    ];
    expect(deduplicateLessons(lessons)).toHaveLength(2);
  });

  test("returns empty for empty input", () => {
    expect(deduplicateLessons([])).toHaveLength(0);
  });
});

describe("getIncludedContext", () => {
  test("always includes PR info", () => {
    const items = getIncludedContext(90, 0);
    expect(items).toContain("pr_title");
    expect(items).toContain("pr_body");
  });

  test("includes failure info when failures exist", () => {
    const items = getIncludedContext(90, 2);
    expect(items).toContain("failure_signatures");
    expect(items).toContain("failure_resolutions");
  });

  test("excludes failure info when no failures", () => {
    const items = getIncludedContext(90, 0);
    expect(items).not.toContain("failure_signatures");
  });

  test("includes review feedback for low scores", () => {
    const items = getIncludedContext(60, 0);
    expect(items).toContain("review_feedback");
    expect(items).toContain("review_scores");
  });

  test("excludes review feedback for high scores", () => {
    const items = getIncludedContext(90, 0);
    expect(items).not.toContain("review_feedback");
  });

  test("always includes diff summary", () => {
    const items = getIncludedContext(90, 0);
    expect(items).toContain("diff_summary");
  });
});
