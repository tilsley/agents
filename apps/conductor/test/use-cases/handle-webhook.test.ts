import { describe, expect, test, mock } from "bun:test";
import { HandleWebhook, type WebhookPayload } from "../../src/application/use-cases/handle-webhook";
import type { OrchestratorPort } from "../../src/application/ports/orchestrator.port";

function createMockOrchestrator(): OrchestratorPort {
  return {
    emit: mock(() => Promise.resolve()),
    on: mock(() => {}),
    off: mock(() => {}),
  };
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    action: "completed",
    eventType: "check_run",
    checkRun: {
      id: 1001,
      name: "ci/tests",
      status: "completed",
      conclusion: "failure",
      headSha: "abc123",
      output: { title: "Tests failed", summary: "2 failures", text: null },
    },
    repository: {
      owner: "test-org",
      name: "test-repo",
    },
    ...overrides,
  };
}

describe("HandleWebhook", () => {
  test("emits check_run.failed for a failed check run", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(makePayload());

    expect(result).not.toBeNull();
    expect(result!.type).toBe("check_run.failed");
    expect(orchestrator.emit).toHaveBeenCalledTimes(1);
  });

  test("includes correct payload in emitted event", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(makePayload());

    expect(result!.payload.owner).toBe("test-org");
    expect(result!.payload.repo).toBe("test-repo");
    expect(result!.payload.headSha).toBe("abc123");
  });

  test("sets correlationId from owner/repo:sha", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(makePayload());

    expect(result!.correlationId).toBe("test-org/test-repo:abc123");
  });

  test("ignores non-check_run events", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(
      makePayload({ eventType: "pull_request" })
    );

    expect(result).toBeNull();
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("ignores non-completed actions", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(
      makePayload({ action: "created" })
    );

    expect(result).toBeNull();
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("ignores payload without checkRun", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(
      makePayload({ checkRun: undefined })
    );

    expect(result).toBeNull();
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("emits check_run.passed for a successful check run", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const result = await useCase.execute(
      makePayload({
        checkRun: {
          id: 2002,
          name: "ci/build",
          status: "completed",
          conclusion: "success",
          headSha: "def456",
          output: { title: "Build passed", summary: null, text: null },
        },
      })
    );

    expect(result!.type).toBe("check_run.passed");
    const checkRun = result!.payload.checkRun as { id: number; name: string };
    expect(checkRun.id).toBe(2002);
    expect(checkRun.name).toBe("ci/build");
  });

  test("includes timestamp in event", async () => {
    const orchestrator = createMockOrchestrator();
    const useCase = new HandleWebhook(orchestrator);

    const before = new Date();
    const result = await useCase.execute(makePayload());
    const after = new Date();

    expect(result!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
