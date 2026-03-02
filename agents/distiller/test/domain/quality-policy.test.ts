import { describe, expect, test } from "bun:test";
import {
  meetsQualityThreshold,
  getQualityScore,
} from "../../src/domain/policies/quality-policy";
import type { Lesson } from "@tilsley/shared";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    problem: "Flaky tests causing CI failures regularly",
    solution: "Added retry logic with exponential backoff",
    context: "CI pipeline for main branch",
    outcome: "Reduced flake rate by 90%",
    tags: ["ci", "testing"],
    metadata: {},
    ...overrides,
  };
}

describe("meetsQualityThreshold", () => {
  test("accepts well-formed lesson", () => {
    expect(meetsQualityThreshold(makeLesson())).toBe(true);
  });

  test("rejects short problem", () => {
    expect(meetsQualityThreshold(makeLesson({ problem: "short" }))).toBe(false);
  });

  test("rejects short solution", () => {
    expect(meetsQualityThreshold(makeLesson({ solution: "fix" }))).toBe(false);
  });

  test("rejects no tags", () => {
    expect(meetsQualityThreshold(makeLesson({ tags: [] }))).toBe(false);
  });

  test("accepts with exactly minimum lengths", () => {
    expect(
      meetsQualityThreshold(
        makeLesson({
          problem: "x".repeat(10),
          solution: "y".repeat(10),
          tags: ["tag"],
        })
      )
    ).toBe(true);
  });
});

describe("getQualityScore", () => {
  test("high-quality lesson scores high", () => {
    const score = getQualityScore(makeLesson());
    expect(score).toBeGreaterThanOrEqual(80);
  });

  test("minimal lesson scores lower", () => {
    const score = getQualityScore(
      makeLesson({
        problem: "x".repeat(10),
        solution: "y".repeat(10),
        context: "",
        outcome: "",
        tags: ["tag"],
      })
    );
    expect(score).toBeLessThan(80);
  });

  test("lesson with no context scores less", () => {
    const withContext = getQualityScore(makeLesson());
    const withoutContext = getQualityScore(makeLesson({ context: "" }));
    expect(withContext).toBeGreaterThan(withoutContext);
  });

  test("more tags give higher score", () => {
    const fewTags = getQualityScore(makeLesson({ tags: ["one"] }));
    const manyTags = getQualityScore(makeLesson({ tags: ["one", "two", "three"] }));
    expect(manyTags).toBeGreaterThan(fewTags);
  });
});
