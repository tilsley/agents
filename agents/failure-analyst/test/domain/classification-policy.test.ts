import { describe, expect, test } from "bun:test";
import {
  classifyByHeuristic,
  shouldTrustLlmClassification,
  mapCategoryToDecision,
  LLM_CONFIDENCE_THRESHOLD,
} from "../../src/domain/policies/classification-policy";

describe("classifyByHeuristic", () => {
  test("classifies ETIMEDOUT as infra_flake", () => {
    const result = classifyByHeuristic("ci/tests", "connect ETIMEDOUT 10.0.0.1:443");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("network_error");
    expect(result!.confidence).toBe(0.85);
  });

  test("classifies ECONNRESET as infra_flake", () => {
    const result = classifyByHeuristic("ci/build", "read ECONNRESET");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("network_error");
  });

  test("classifies ECONNREFUSED as infra_flake", () => {
    const result = classifyByHeuristic("ci/build", "connect ECONNREFUSED 127.0.0.1:5432");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
  });

  test("classifies rate limit as infra_flake", () => {
    const result = classifyByHeuristic("ci/deploy", "API rate limit exceeded");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("rate_limit");
  });

  test("does not classify timeout as infra_flake (ambiguous — let LLM decide)", () => {
    const result = classifyByHeuristic("ci/tests", "Test timed out after 30000ms");
    expect(result).toBeNull();
  });

  test("classifies socket hang up as infra_flake", () => {
    const result = classifyByHeuristic("ci/tests", "socket hang up");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("socket_hangup");
  });

  test("classifies out of memory as infra_flake", () => {
    const result = classifyByHeuristic("ci/build", "FATAL ERROR: ENOMEM");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("oom");
  });

  test("does not classify TypeError as code_bug (delegated to LLM)", () => {
    const result = classifyByHeuristic("ci/tests", "TypeError: Cannot read property 'id'");
    expect(result).toBeNull();
  });

  test("does not classify SyntaxError as code_bug (delegated to LLM)", () => {
    const result = classifyByHeuristic("ci/lint", "SyntaxError: Unexpected token");
    expect(result).toBeNull();
  });

  test("returns null for unrecognized output", () => {
    const result = classifyByHeuristic("ci/tests", "Everything passed with warnings");
    expect(result).toBeNull();
  });

  test("includes matched pattern in result", () => {
    const result = classifyByHeuristic("ci/tests", "Error: connect ETIMEDOUT 1.2.3.4:443");
    expect(result).not.toBeNull();
    expect(result!.errorPattern).toBe("ETIMEDOUT");
  });
});

describe("shouldTrustLlmClassification", () => {
  test("trusts classification at threshold", () => {
    expect(shouldTrustLlmClassification(LLM_CONFIDENCE_THRESHOLD)).toBe(true);
  });

  test("trusts classification above threshold", () => {
    expect(shouldTrustLlmClassification(0.9)).toBe(true);
  });

  test("rejects classification below threshold", () => {
    expect(shouldTrustLlmClassification(0.3)).toBe(false);
  });

  test("rejects zero confidence", () => {
    expect(shouldTrustLlmClassification(0)).toBe(false);
  });
});

describe("mapCategoryToDecision", () => {
  test("infra_flake with retries remaining returns retry", () => {
    expect(
      mapCategoryToDecision({ category: "infra_flake", retryCount: 0, maxRetries: 3 })
    ).toBe("retry");
  });

  test("infra_flake at max retries returns escalate", () => {
    expect(
      mapCategoryToDecision({ category: "infra_flake", retryCount: 3, maxRetries: 3 })
    ).toBe("escalate");
  });

  test("infra_flake over max retries returns escalate", () => {
    expect(
      mapCategoryToDecision({ category: "infra_flake", retryCount: 5, maxRetries: 3 })
    ).toBe("escalate");
  });

  test("code_bug always returns route_to_fixer", () => {
    expect(
      mapCategoryToDecision({ category: "code_bug", retryCount: 0, maxRetries: 3 })
    ).toBe("route_to_fixer");
  });

  test("code_bug ignores retry count", () => {
    expect(
      mapCategoryToDecision({ category: "code_bug", retryCount: 10, maxRetries: 3 })
    ).toBe("route_to_fixer");
  });

  test("unknown returns skip", () => {
    expect(
      mapCategoryToDecision({ category: "unknown", retryCount: 0, maxRetries: 3 })
    ).toBe("skip");
  });
});
