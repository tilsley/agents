import { describe, expect, test } from "bun:test";
import { shouldEscalateRetry } from "../../src/domain/policies/retry-policy";

describe("shouldEscalateRetry", () => {
  test("does not escalate when count is 0", () => {
    expect(shouldEscalateRetry(0, 3)).toBe(false);
  });

  test("does not escalate when below max", () => {
    expect(shouldEscalateRetry(2, 3)).toBe(false);
  });

  test("escalates when count equals max", () => {
    expect(shouldEscalateRetry(3, 3)).toBe(true);
  });

  test("escalates when count exceeds max", () => {
    expect(shouldEscalateRetry(5, 3)).toBe(true);
  });

  test("escalates with max of 0", () => {
    expect(shouldEscalateRetry(0, 0)).toBe(true);
  });
});
