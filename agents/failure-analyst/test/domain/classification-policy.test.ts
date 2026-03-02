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
    expect(result!.confidence).toBe(0.8);
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

  test("classifies timeout as infra_flake", () => {
    const result = classifyByHeuristic("ci/tests", "Test timed out after 30000ms");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
    expect(result!.errorType).toBe("timeout");
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

  test("classifies TypeError as code_bug", () => {
    const result = classifyByHeuristic("ci/tests", "TypeError: Cannot read property 'id'");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("js_error");
    expect(result!.confidence).toBe(0.7);
  });

  test("classifies SyntaxError as code_bug", () => {
    const result = classifyByHeuristic("ci/lint", "SyntaxError: Unexpected token");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("js_error");
  });

  test("classifies compilation error as code_bug", () => {
    const result = classifyByHeuristic("ci/build", "Compilation error in module");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("compilation_error");
  });

  test("classifies missing import as code_bug", () => {
    const result = classifyByHeuristic("ci/build", "Cannot find module '@foo/bar'");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("import_error");
  });

  test("classifies type assignment error as code_bug", () => {
    const result = classifyByHeuristic("ci/build", "type 'string' is not assignable to type 'number'");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("type_error");
  });

  test("classifies assertion failure as code_bug", () => {
    const result = classifyByHeuristic("ci/tests", "expected 42 but received undefined");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("code_bug");
    expect(result!.errorType).toBe("assertion_failure");
  });

  test("returns null for unrecognized output", () => {
    const result = classifyByHeuristic("ci/tests", "Everything passed with warnings");
    expect(result).toBeNull();
  });

  test("flake patterns take priority over bug patterns", () => {
    // This output contains both timeout (flake) and SyntaxError (bug)
    const result = classifyByHeuristic("ci/tests", "Test timed out\nSyntaxError: foo");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("infra_flake");
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
