import { describe, expect, test } from "bun:test";
import {
  formatLessonForStorage,
  formatLessonSummary,
} from "../../src/domain/utils/format-lesson";
import type { Lesson } from "@tilsley/shared";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    problem: "Flaky test in CI",
    solution: "Add retry logic",
    context: "CI pipeline",
    outcome: "Reduced flakes",
    tags: ["ci", "testing"],
    metadata: {},
    ...overrides,
  };
}

describe("formatLessonForStorage", () => {
  test("creates MemoryDocument with lesson content", () => {
    const doc = formatLessonForStorage(makeLesson());
    expect(doc.content).toContain("Problem: Flaky test in CI");
    expect(doc.content).toContain("Solution: Add retry logic");
    expect(doc.content).toContain("Context: CI pipeline");
    expect(doc.content).toContain("Outcome: Reduced flakes");
  });

  test("generates a non-empty ID", () => {
    const doc = formatLessonForStorage(makeLesson());
    expect(doc.id).toMatch(/^lesson-/);
    expect(doc.id.length).toBeGreaterThan(7);
  });

  test("includes tags in metadata", () => {
    const doc = formatLessonForStorage(makeLesson());
    expect(doc.metadata.tags).toEqual(["ci", "testing"]);
  });

  test("includes type metadata", () => {
    const doc = formatLessonForStorage(makeLesson());
    expect(doc.metadata.type).toBe("lesson");
  });

  test("generates different IDs for different lessons", () => {
    const doc1 = formatLessonForStorage(makeLesson({ problem: "A" }));
    const doc2 = formatLessonForStorage(makeLesson({ problem: "B" }));
    expect(doc1.id).not.toBe(doc2.id);
  });
});

describe("formatLessonSummary", () => {
  test("formats lesson list", () => {
    const summary = formatLessonSummary([makeLesson()]);
    expect(summary).toContain("1.");
    expect(summary).toContain("Flaky test in CI");
    expect(summary).toContain("Add retry logic");
  });

  test("returns message for empty list", () => {
    expect(formatLessonSummary([])).toBe("No lessons extracted.");
  });

  test("numbers multiple lessons", () => {
    const summary = formatLessonSummary([
      makeLesson({ problem: "Problem A" }),
      makeLesson({ problem: "Problem B" }),
    ]);
    expect(summary).toContain("1.");
    expect(summary).toContain("2.");
  });

  test("includes tags in summary", () => {
    const summary = formatLessonSummary([makeLesson()]);
    expect(summary).toContain("ci, testing");
  });
});
