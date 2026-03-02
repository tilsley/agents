import { describe, expect, test } from "bun:test";
import { shouldEscalateRerun } from "../../src/domain/policies/rerun-policy";

describe("shouldEscalateRerun", () => {
  test("returns false when count is below max", () => {
    expect(shouldEscalateRerun(0, 3)).toBe(false);
    expect(shouldEscalateRerun(1, 3)).toBe(false);
    expect(shouldEscalateRerun(2, 3)).toBe(false);
  });

  test("returns true when count equals max", () => {
    expect(shouldEscalateRerun(3, 3)).toBe(true);
  });

  test("returns true when count exceeds max", () => {
    expect(shouldEscalateRerun(5, 3)).toBe(true);
  });

  test("returns true immediately when max is 0", () => {
    expect(shouldEscalateRerun(0, 0)).toBe(true);
  });
});
