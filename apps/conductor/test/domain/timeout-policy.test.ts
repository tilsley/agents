import { describe, expect, test } from "bun:test";
import {
  getTimeoutForAgent,
  isTimedOut,
} from "../../src/domain/policies/timeout-policy";

describe("getTimeoutForAgent", () => {
  test("failure-analyst has 2 minute timeout", () => {
    expect(getTimeoutForAgent("failure-analyst")).toBe(2 * 60 * 1000);
  });

  test("review-agent has 5 minute timeout", () => {
    expect(getTimeoutForAgent("review-agent")).toBe(5 * 60 * 1000);
  });

  test("distiller has 3 minute timeout", () => {
    expect(getTimeoutForAgent("distiller")).toBe(3 * 60 * 1000);
  });
});

describe("isTimedOut", () => {
  test("not timed out when within window", () => {
    const now = new Date();
    const assignedAt = new Date(now.getTime() - 30_000); // 30 seconds ago
    expect(isTimedOut(assignedAt, "failure-analyst", now)).toBe(false);
  });

  test("timed out when past deadline", () => {
    const now = new Date();
    const assignedAt = new Date(now.getTime() - 3 * 60 * 1000); // 3 min ago
    expect(isTimedOut(assignedAt, "failure-analyst", now)).toBe(true); // 2 min timeout
  });

  test("not timed out at exact boundary", () => {
    const now = new Date();
    const assignedAt = new Date(now.getTime() - 2 * 60 * 1000); // exactly 2 min
    expect(isTimedOut(assignedAt, "failure-analyst", now)).toBe(false);
  });

  test("respects agent-specific timeouts", () => {
    const now = new Date();
    const assignedAt = new Date(now.getTime() - 4 * 60 * 1000); // 4 min ago
    // failure-analyst (2 min) → timed out
    expect(isTimedOut(assignedAt, "failure-analyst", now)).toBe(true);
    // review-agent (5 min) → not timed out
    expect(isTimedOut(assignedAt, "review-agent", now)).toBe(false);
  });
});
