import { describe, expect, test } from "bun:test";
import {
  makeReviewDecision,
  calculateOverallScore,
} from "../../src/domain/policies/review-policy";

describe("makeReviewDecision", () => {
  test("approves when score is above threshold", () => {
    expect(makeReviewDecision(85)).toBe("approve");
  });

  test("approves at exact threshold", () => {
    expect(makeReviewDecision(80)).toBe("approve");
  });

  test("requests changes when score is below threshold", () => {
    expect(makeReviewDecision(30)).toBe("request_changes");
  });

  test("requests changes at exact lower threshold", () => {
    expect(makeReviewDecision(40)).toBe("request_changes");
  });

  test("escalates in between thresholds", () => {
    expect(makeReviewDecision(60)).toBe("escalate");
  });

  test("escalates at 41 (just above reject)", () => {
    expect(makeReviewDecision(41)).toBe("escalate");
  });

  test("escalates at 79 (just below approve)", () => {
    expect(makeReviewDecision(79)).toBe("escalate");
  });

  test("respects custom thresholds", () => {
    expect(
      makeReviewDecision(90, { approveAbove: 95, rejectBelow: 20 })
    ).toBe("escalate");
  });

  test("approves with custom thresholds", () => {
    expect(
      makeReviewDecision(96, { approveAbove: 95, rejectBelow: 20 })
    ).toBe("approve");
  });

  test("rejects with custom thresholds", () => {
    expect(
      makeReviewDecision(15, { approveAbove: 95, rejectBelow: 20 })
    ).toBe("request_changes");
  });
});

describe("calculateOverallScore", () => {
  test("returns 0 for empty scores", () => {
    expect(calculateOverallScore([])).toBe(0);
  });

  test("calculates weighted average", () => {
    const scores = [
      { score: 100, weight: 1 },
      { score: 50, weight: 1 },
    ];
    expect(calculateOverallScore(scores)).toBe(75);
  });

  test("respects different weights", () => {
    const scores = [
      { score: 100, weight: 3 },
      { score: 0, weight: 1 },
    ];
    expect(calculateOverallScore(scores)).toBe(75);
  });

  test("returns 0 when total weight is 0", () => {
    const scores = [
      { score: 100, weight: 0 },
      { score: 50, weight: 0 },
    ];
    expect(calculateOverallScore(scores)).toBe(0);
  });

  test("rounds to nearest integer", () => {
    const scores = [
      { score: 33, weight: 1 },
      { score: 67, weight: 1 },
    ];
    expect(calculateOverallScore(scores)).toBe(50);
  });

  test("handles single score", () => {
    expect(calculateOverallScore([{ score: 85, weight: 1 }])).toBe(85);
  });
});
