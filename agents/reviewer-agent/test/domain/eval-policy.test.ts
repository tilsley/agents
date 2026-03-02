import { describe, expect, test } from "bun:test";
import {
  isSuccessfulCheck,
  isAllChecksPassed,
  shouldRunEval,
  determineEvalAction,
} from "../../src/domain/policies/eval-policy";

describe("isSuccessfulCheck", () => {
  test("returns true for success", () => {
    expect(isSuccessfulCheck("success")).toBe(true);
  });

  test("returns false for failure", () => {
    expect(isSuccessfulCheck("failure")).toBe(false);
  });

  test("returns false for timed_out", () => {
    expect(isSuccessfulCheck("timed_out")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isSuccessfulCheck(null)).toBe(false);
  });
});

describe("isAllChecksPassed", () => {
  test("returns true when all checks completed and successful", () => {
    const checks = [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "success" },
    ];
    expect(isAllChecksPassed(checks)).toBe(true);
  });

  test("returns false when one check is pending", () => {
    const checks = [
      { status: "completed", conclusion: "success" },
      { status: "in_progress", conclusion: null },
    ];
    expect(isAllChecksPassed(checks)).toBe(false);
  });

  test("returns false when one check failed", () => {
    const checks = [
      { status: "completed", conclusion: "success" },
      { status: "completed", conclusion: "failure" },
    ];
    expect(isAllChecksPassed(checks)).toBe(false);
  });

  test("returns false for empty checks array", () => {
    expect(isAllChecksPassed([])).toBe(false);
  });

  test("returns false when conclusion is null", () => {
    const checks = [{ status: "completed", conclusion: null }];
    expect(isAllChecksPassed(checks)).toBe(false);
  });
});

describe("shouldRunEval", () => {
  const bot = "my-bot[bot]";

  test("returns true for bot PR with success", () => {
    expect(shouldRunEval(bot, bot, "success")).toBe(true);
  });

  test("returns false for non-bot PR with success", () => {
    expect(shouldRunEval("human", bot, "success")).toBe(false);
  });

  test("returns false for bot PR with failure", () => {
    expect(shouldRunEval(bot, bot, "failure")).toBe(false);
  });

  test("returns false for non-bot PR with failure", () => {
    expect(shouldRunEval("human", bot, "failure")).toBe(false);
  });
});

describe("determineEvalAction", () => {
  const thresholds = { approveAbove: 80, requestChangesBelow: 40 };

  test("returns approve when score is above threshold", () => {
    expect(determineEvalAction(85, thresholds)).toBe("approve");
  });

  test("returns approve when score equals threshold", () => {
    expect(determineEvalAction(80, thresholds)).toBe("approve");
  });

  test("returns request_changes when score is below threshold", () => {
    expect(determineEvalAction(30, thresholds)).toBe("request_changes");
  });

  test("returns request_changes when score equals threshold", () => {
    expect(determineEvalAction(40, thresholds)).toBe("request_changes");
  });

  test("returns none when score is between thresholds", () => {
    expect(determineEvalAction(60, thresholds)).toBe("none");
  });

  test("returns approve for score of 100", () => {
    expect(determineEvalAction(100, thresholds)).toBe("approve");
  });

  test("returns request_changes for score of 0", () => {
    expect(determineEvalAction(0, thresholds)).toBe("request_changes");
  });
});
