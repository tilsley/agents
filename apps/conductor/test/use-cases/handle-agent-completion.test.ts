import { describe, expect, test, mock } from "bun:test";
import { HandleAgentCompletion } from "../../src/application/use-cases/handle-agent-completion";
import type { OrchestratorPort } from "../../src/application/ports/orchestrator.port";
import type { AgentResult } from "@tilsley/shared";

function createMockOrchestrator(): OrchestratorPort {
  return {
    emit: mock(() => Promise.resolve()),
    on: mock(() => {}),
    off: mock(() => {}),
  };
}

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    taskId: "task-1",
    status: "success",
    output: { analyses: [] },
    ...overrides,
  };
}

describe("HandleAgentCompletion", () => {
  test("emits next stage event on success", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult(),
      "corr-1"
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe("failure-analysis.completed");
    expect(orchestrator.emit).toHaveBeenCalledTimes(1);
  });

  test("emits pipeline.failed on agent failure", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult({ status: "failure", output: { error: "boom" } }),
      "corr-1"
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe("pipeline.failed");
    expect(result!.payload.failedAt).toBe("check_run.failed");
    expect(orchestrator.emit).toHaveBeenCalledTimes(1);
  });

  test("returns null for terminal events", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "distillation.completed",
      makeResult(),
      "corr-1"
    );

    expect(result).toBeNull();
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("preserves correlationId across stages", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult(),
      "my-correlation-id"
    );

    expect(result!.correlationId).toBe("my-correlation-id");
  });

  test("maps failure-analysis.completed to review.completed", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "failure-analysis.completed",
      makeResult(),
      "corr-1"
    );

    expect(result!.type).toBe("review.completed");
  });

  test("maps review.completed to distillation.completed", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "review.completed",
      makeResult(),
      "corr-1"
    );

    expect(result!.type).toBe("distillation.completed");
  });

  test("includes agent output in next event payload", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult({ output: { analyses: [{ id: 1 }] } }),
      "corr-1"
    );

    expect(result!.payload.analyses).toEqual([{ id: 1 }]);
  });

  test("includes taskId in next event payload", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult({ taskId: "task-42" }),
      "corr-1"
    );

    expect(result!.payload.taskId).toBe("task-42");
  });

  test("returns null for unknown non-terminal event with no next stage", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "unknown.event",
      makeResult(),
      "corr-1"
    );

    expect(result).toBeNull();
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("failure event includes taskId", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleAgentCompletion(orchestrator);

    const result = await useCase.execute(
      "check_run.failed",
      makeResult({ status: "failure", taskId: "task-99" }),
      "corr-1"
    );

    expect(result!.payload.taskId).toBe("task-99");
  });
});
