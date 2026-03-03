import { describe, expect, test } from "bun:test";
import { deriveReviewMode } from "../../src/domain/policies/review-mode-policy";
import type { FailureDecision } from "@tilsley/failure-analyst/src/domain/entities/failure-analysis";

describe("deriveReviewMode", () => {
  test("returns full mode when no decisions", () => {
    const result = deriveReviewMode([]);
    expect(result.mode).toBe("full");
    expect(result.reason).toBeUndefined();
  });

  test("returns advisory mode for route_to_fixer", () => {
    const result = deriveReviewMode(["route_to_fixer"]);
    expect(result.mode).toBe("advisory");
    expect(result.reason).toContain("code bug");
  });

  test("returns advisory mode for escalate", () => {
    const result = deriveReviewMode(["escalate"]);
    expect(result.mode).toBe("advisory");
    expect(result.reason).toContain("retries");
  });

  test("returns full mode for skip only", () => {
    const result = deriveReviewMode(["skip"]);
    expect(result.mode).toBe("full");
  });

  test("returns full mode for retry only", () => {
    const result = deriveReviewMode(["retry"]);
    expect(result.mode).toBe("full");
  });

  test("route_to_fixer wins over escalate (worst-wins)", () => {
    const decisions: FailureDecision[] = ["skip", "route_to_fixer", "escalate"];
    const result = deriveReviewMode(decisions);
    expect(result.mode).toBe("advisory");
    expect(result.reason).toContain("code bug");
  });

  test("escalate wins when no route_to_fixer", () => {
    const decisions: FailureDecision[] = ["retry", "skip", "escalate"];
    const result = deriveReviewMode(decisions);
    expect(result.mode).toBe("advisory");
    expect(result.reason).toContain("retries");
  });
});
