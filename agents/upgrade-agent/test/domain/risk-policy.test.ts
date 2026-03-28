import { describe, expect, test } from "bun:test";
import { deriveRiskLevel } from "../../src/domain/policies/risk-policy";

describe("deriveRiskLevel", () => {
  test("major version bump → critical", () => {
    expect(deriveRiskLevel("1.0.0", "2.0.0")).toBe("critical");
    expect(deriveRiskLevel("3.14.0", "4.0.0")).toBe("critical");
  });

  test("major version downgrade → critical", () => {
    expect(deriveRiskLevel("2.0.0", "1.9.9")).toBe("critical");
  });

  test("50+ minor versions → critical", () => {
    expect(deriveRiskLevel("2.63.0", "2.187.0")).toBe("critical"); // aws-cdk-lib case
    expect(deriveRiskLevel("1.0.0", "1.50.0")).toBe("critical");
  });

  test("11–49 minor versions → high", () => {
    expect(deriveRiskLevel("1.0.0", "1.20.0")).toBe("high");
    expect(deriveRiskLevel("2.100.0", "2.120.0")).toBe("high");
    expect(deriveRiskLevel("4.17.4", "4.28.0")).toBe("high");
  });

  test("5–10 minor versions → medium", () => {
    expect(deriveRiskLevel("1.0.0", "1.7.0")).toBe("medium");
    expect(deriveRiskLevel("3.0.0", "3.10.0")).toBe("medium");
  });

  test("1–4 minor versions → low", () => {
    expect(deriveRiskLevel("1.0.0", "1.3.0")).toBe("low");
    expect(deriveRiskLevel("4.17.4", "4.17.21")).toBe("low"); // same minor, patch bump
  });

  test("patch-only bump → low", () => {
    expect(deriveRiskLevel("1.2.3", "1.2.99")).toBe("low");
  });

  test("strips semver range prefixes (^, ~, v)", () => {
    expect(deriveRiskLevel("^1.0.0", "^2.0.0")).toBe("critical");
    expect(deriveRiskLevel("~4.17.4", "~4.28.0")).toBe("high");
  });

  test("unparseable version → high (safe default)", () => {
    expect(deriveRiskLevel("unknown", "1.0.0")).toBe("high");
    expect(deriveRiskLevel("1.0.0", "latest")).toBe("high");
  });
});
