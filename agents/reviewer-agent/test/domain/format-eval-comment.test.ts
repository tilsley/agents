import { describe, expect, test } from "bun:test";
import { formatEvalComment } from "../../src/domain/utils/format-eval-comment";
import type { EvalResult } from "../../src/domain/entities/eval-result";

describe("formatEvalComment", () => {
  test("includes score in header", () => {
    const result: EvalResult = {
      score: 85,
      summary: "Good quality PR",
      breakdown: [],
      action: "none",
    };
    const comment = formatEvalComment(result);
    expect(comment).toContain("## PR Eval: 85/100");
  });

  test("includes summary", () => {
    const result: EvalResult = {
      score: 70,
      summary: "Decent but could improve",
      breakdown: [],
      action: "none",
    };
    const comment = formatEvalComment(result);
    expect(comment).toContain("Decent but could improve");
  });

  test("includes breakdown table", () => {
    const result: EvalResult = {
      score: 75,
      summary: "Mixed results",
      breakdown: [
        { criterion: "Code quality", score: 80, reasoning: "Clean code" },
        { criterion: "Test coverage", score: 60, reasoning: "Missing tests" },
      ],
      action: "none",
    };
    const comment = formatEvalComment(result);
    expect(comment).toContain("| Criterion | Score | Reasoning |");
    expect(comment).toContain("| Code quality | 80 | Clean code |");
    expect(comment).toContain("| Test coverage | 60 | Missing tests |");
  });

  test("shows auto-approved action", () => {
    const result: EvalResult = {
      score: 90,
      summary: "Great",
      breakdown: [],
      action: "approve",
    };
    const comment = formatEvalComment(result);
    expect(comment).toContain("**Action:** Auto-approved");
  });

  test("shows changes requested action", () => {
    const result: EvalResult = {
      score: 20,
      summary: "Needs work",
      breakdown: [],
      action: "request_changes",
    };
    const comment = formatEvalComment(result);
    expect(comment).toContain("**Action:** Changes requested");
  });

  test("omits action line for none", () => {
    const result: EvalResult = {
      score: 60,
      summary: "OK",
      breakdown: [],
      action: "none",
    };
    const comment = formatEvalComment(result);
    expect(comment).not.toContain("**Action:**");
  });

  test("handles empty breakdown", () => {
    const result: EvalResult = {
      score: 50,
      summary: "Neutral",
      breakdown: [],
      action: "none",
    };
    const comment = formatEvalComment(result);
    expect(comment).not.toContain("| Criterion");
  });
});
