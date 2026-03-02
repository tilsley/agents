import { describe, expect, test } from "bun:test";
import { formatFailureReport } from "../../src/domain/utils/format-failure-report";
import type { FailureAnalysis } from "../../src/domain/entities/failure-analysis";

function makeAnalysis(overrides: Partial<FailureAnalysis> = {}): FailureAnalysis {
  return {
    checkRunId: 1001,
    checkName: "ci/tests",
    category: "infra_flake",
    decision: "retry",
    signature: {
      checkName: "ci/tests",
      errorType: "timeout",
      errorPattern: "timed out",
      category: "infra_flake",
      confidence: 0.8,
    },
    reasoning: "Test timed out — likely flaky",
    ...overrides,
  };
}

describe("formatFailureReport", () => {
  test("returns empty message for no analyses", () => {
    expect(formatFailureReport([])).toBe("No failures to report.");
  });

  test("includes header with count", () => {
    const report = formatFailureReport([makeAnalysis()]);
    expect(report).toContain("Failure Analysis Report (1 checks)");
  });

  test("includes check name and ID", () => {
    const report = formatFailureReport([makeAnalysis()]);
    expect(report).toContain("ci/tests (ID: 1001)");
  });

  test("includes category and decision", () => {
    const report = formatFailureReport([makeAnalysis()]);
    expect(report).toContain("**Category:** infra_flake");
    expect(report).toContain("**Decision:** retry");
  });

  test("includes confidence as percentage", () => {
    const report = formatFailureReport([makeAnalysis()]);
    expect(report).toContain("**Confidence:** 80%");
  });

  test("formats multiple analyses", () => {
    const analyses = [
      makeAnalysis({ checkRunId: 1001, checkName: "ci/tests" }),
      makeAnalysis({
        checkRunId: 1002,
        checkName: "ci/build",
        category: "code_bug",
        decision: "route_to_fixer",
      }),
    ];
    const report = formatFailureReport(analyses);
    expect(report).toContain("2 checks");
    expect(report).toContain("ci/tests");
    expect(report).toContain("ci/build");
  });

  test("includes reasoning", () => {
    const report = formatFailureReport([
      makeAnalysis({ reasoning: "Network timeout detected" }),
    ]);
    expect(report).toContain("Network timeout detected");
  });
});
