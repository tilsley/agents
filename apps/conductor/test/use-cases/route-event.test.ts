import { describe, expect, test, mock } from "bun:test";
import { RouteEvent, type AgentDispatcher } from "../../src/application/use-cases/route-event";
import { InMemoryOrchestratorAdapter } from "../../src/adapters/orchestrator/in-memory-orchestrator.adapter";
import type { PipelineEvent } from "@tilsley/shared";

function makeEvent(type: string, overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  return {
    type,
    payload: { owner: "test-org", repo: "test-repo" },
    timestamp: new Date(),
    correlationId: "test-org/test-repo:abc123",
    ...overrides,
  };
}

describe("RouteEvent", () => {
  test("dispatches check_run.failed to failure-analyst", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("check_run.failed"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [agentType, task] = (dispatch as ReturnType<typeof mock>).mock.calls[0];
    expect(agentType).toBe("failure-analyst");
    expect(task.type).toBe("check_run.failed");
  });

  test("dispatches check_run.passed directly to review-agent", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("check_run.passed"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [agentType, task] = (dispatch as ReturnType<typeof mock>).mock.calls[0];
    expect(agentType).toBe("review-agent");
    expect(task.type).toBe("check_run.passed");
  });

  test("dispatches failure-analysis.completed to review-agent", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("failure-analysis.completed"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [agentType] = (dispatch as ReturnType<typeof mock>).mock.calls[0];
    expect(agentType).toBe("review-agent");
  });

  test("dispatches review.completed to distiller", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("review.completed"));

    expect(dispatch).toHaveBeenCalledTimes(1);
    const [agentType] = (dispatch as ReturnType<typeof mock>).mock.calls[0];
    expect(agentType).toBe("distiller");
  });

  test("ignores unknown event types", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("random.event"));

    expect(dispatch).not.toHaveBeenCalled();
  });

  test("assigns unique task IDs", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("check_run.failed"));
    await orchestrator.emit(makeEvent("check_run.failed"));

    const taskId1 = (dispatch as ReturnType<typeof mock>).mock.calls[0][1].taskId;
    const taskId2 = (dispatch as ReturnType<typeof mock>).mock.calls[1][1].taskId;
    expect(taskId1).not.toBe(taskId2);
  });

  test("includes correlationId in task payload", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(
      makeEvent("check_run.failed", {
        correlationId: "custom-correlation",
      })
    );

    const task = (dispatch as ReturnType<typeof mock>).mock.calls[0][1];
    expect(task.payload.correlationId).toBe("custom-correlation");
  });

  test("propagates event payload to task", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(
      makeEvent("check_run.failed", {
        payload: { owner: "my-org", repo: "my-repo", headSha: "sha1" },
      })
    );

    const task = (dispatch as ReturnType<typeof mock>).mock.calls[0][1];
    expect(task.payload.owner).toBe("my-org");
    expect(task.payload.repo).toBe("my-repo");
  });

  test("handles multiple event types simultaneously", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const dispatch: AgentDispatcher = mock(() => Promise.resolve());
    const router = new RouteEvent(orchestrator, dispatch);

    router.start();
    await orchestrator.emit(makeEvent("check_run.failed"));
    await orchestrator.emit(makeEvent("failure-analysis.completed"));

    expect(dispatch).toHaveBeenCalledTimes(2);
    const agents = (dispatch as ReturnType<typeof mock>).mock.calls.map(
      (c: unknown[]) => c[0]
    );
    expect(agents).toContain("failure-analyst");
    expect(agents).toContain("review-agent");
  });
});
