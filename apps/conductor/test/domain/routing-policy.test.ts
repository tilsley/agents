import { describe, expect, test } from "bun:test";
import {
  getAgentForEvent,
  getNextStageEvent,
  isTerminalEvent,
  getSupportedEventTypes,
} from "../../src/domain/policies/routing-policy";

describe("getAgentForEvent", () => {
  test("routes pull_request.opened to context-store", () => {
    expect(getAgentForEvent("pull_request.opened")).toBe("context-store");
  });

  test("routes check_run.passed directly to review-agent", () => {
    expect(getAgentForEvent("check_run.passed")).toBe("review-agent");
  });

  test("routes check_run.failed to failure-analyst", () => {
    expect(getAgentForEvent("check_run.failed")).toBe("failure-analyst");
  });

  test("routes failure-analysis.completed to review-agent", () => {
    expect(getAgentForEvent("failure-analysis.completed")).toBe("review-agent");
  });

  test("routes review.completed to distiller", () => {
    expect(getAgentForEvent("review.completed")).toBe("distiller");
  });

  test("returns null for unknown event type", () => {
    expect(getAgentForEvent("unknown.event")).toBeNull();
  });

  test("returns null for check_run.completed (no longer routed)", () => {
    expect(getAgentForEvent("check_run.completed")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(getAgentForEvent("")).toBeNull();
  });
});

describe("getNextStageEvent", () => {
  test("check_run.failed leads to failure-analysis.completed", () => {
    expect(getNextStageEvent("check_run.failed")).toBe(
      "failure-analysis.completed"
    );
  });

  test("failure-analysis.completed leads to review.completed", () => {
    expect(getNextStageEvent("failure-analysis.completed")).toBe(
      "review.completed"
    );
  });

  test("review.completed leads to distillation.completed", () => {
    expect(getNextStageEvent("review.completed")).toBe(
      "distillation.completed"
    );
  });

  test("check_run.passed has no next stage (goes directly, no chaining needed)", () => {
    expect(getNextStageEvent("check_run.passed")).toBeNull();
  });

  test("returns null for unknown event", () => {
    expect(getNextStageEvent("random.event")).toBeNull();
  });
});

describe("isTerminalEvent", () => {
  test("distillation.completed is terminal", () => {
    expect(isTerminalEvent("distillation.completed")).toBe(true);
  });

  test("pipeline.failed is terminal", () => {
    expect(isTerminalEvent("pipeline.failed")).toBe(true);
  });

  test("check_run.completed is not terminal", () => {
    expect(isTerminalEvent("check_run.completed")).toBe(false);
  });

  test("failure-analysis.completed is not terminal", () => {
    expect(isTerminalEvent("failure-analysis.completed")).toBe(false);
  });
});

describe("getSupportedEventTypes", () => {
  test("returns all supported event types", () => {
    const types = getSupportedEventTypes();
    expect(types).toContain("pull_request.opened");
    expect(types).toContain("check_run.passed");
    expect(types).toContain("check_run.failed");
    expect(types).toContain("failure-analysis.completed");
    expect(types).toContain("review.completed");
    expect(types).not.toContain("check_run.completed");
    expect(types.length).toBe(5);
  });
});
