import { describe, expect, test, mock } from "bun:test";
import { createConductorWebhookServer } from "../../src/adapters/http/webhook.server";
import { HandleWebhook } from "../../src/application/use-cases/handle-webhook";
import type { OrchestratorPort } from "../../src/application/ports/orchestrator.port";
import { Webhooks } from "@octokit/webhooks";

const TEST_SECRET = "test-webhook-secret";

function createMockOrchestrator(): OrchestratorPort {
  return {
    emit: mock(() => Promise.resolve()),
    on: mock(() => {}),
    off: mock(() => {}),
  };
}

async function signPayload(payload: string): Promise<string> {
  const webhooks = new Webhooks({ secret: TEST_SECRET });
  return webhooks.sign(payload);
}

describe("ConductorWebhookServer", () => {
  test("health endpoint returns ok", async () => {
    const orchestrator = createMockOrchestrator();
    const handleWebhook = new HandleWebhook(orchestrator);
    const app = createConductorWebhookServer({
      webhookSecret: TEST_SECRET,
      handleWebhook,
    });

    const res = await app.request("/health");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
  });

  test("rejects invalid signature", async () => {
    const orchestrator = createMockOrchestrator();
    const handleWebhook = new HandleWebhook(orchestrator);
    const app = createConductorWebhookServer({
      webhookSecret: TEST_SECRET,
      handleWebhook,
    });

    const payload = JSON.stringify({
      action: "completed",
      check_run: {
        id: 1001,
        name: "ci/tests",
        status: "completed",
        conclusion: "failure",
        head_sha: "abc123",
        output: { title: null, summary: null, text: null },
      },
      repository: { owner: { login: "org" }, name: "repo" },
    });

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": "sha256=invalid",
        "content-type": "application/json",
      },
      body: payload,
    });

    expect(res.status).toBe(401);
  });

  test("processes valid check_run webhook", async () => {
    const orchestrator = createMockOrchestrator();
    const handleWebhook = new HandleWebhook(orchestrator);
    const app = createConductorWebhookServer({
      webhookSecret: TEST_SECRET,
      handleWebhook,
    });

    const payload = JSON.stringify({
      action: "completed",
      check_run: {
        id: 1001,
        name: "ci/tests",
        status: "completed",
        conclusion: "failure",
        head_sha: "abc123",
        output: { title: "Failed", summary: null, text: null },
      },
      repository: { owner: { login: "org" }, name: "repo" },
    });

    const signature = await signPayload(payload);

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("processing");
    expect(orchestrator.emit).toHaveBeenCalledTimes(1);
  });

  test("ignores non-check_run events", async () => {
    const orchestrator = createMockOrchestrator();
    const handleWebhook = new HandleWebhook(orchestrator);
    const app = createConductorWebhookServer({
      webhookSecret: TEST_SECRET,
      handleWebhook,
    });

    const payload = JSON.stringify({
      action: "opened",
      repository: { owner: { login: "org" }, name: "repo" },
    });

    const signature = await signPayload(payload);

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("ignored");
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });

  test("ignores non-completed check_run actions", async () => {
    const orchestrator = createMockOrchestrator();
    const handleWebhook = new HandleWebhook(orchestrator);
    const app = createConductorWebhookServer({
      webhookSecret: TEST_SECRET,
      handleWebhook,
    });

    const payload = JSON.stringify({
      action: "created",
      check_run: {
        id: 1001,
        name: "ci/tests",
        status: "in_progress",
        conclusion: null,
        head_sha: "abc123",
        output: { title: null, summary: null, text: null },
      },
      repository: { owner: { login: "org" }, name: "repo" },
    });

    const signature = await signPayload(payload);

    const res = await app.request("/webhook", {
      method: "POST",
      headers: {
        "x-github-event": "check_run",
        "x-hub-signature-256": signature,
        "content-type": "application/json",
      },
      body: payload,
    });

    const json = await res.json();
    expect(json.status).toBe("ignored");
    expect(orchestrator.emit).not.toHaveBeenCalled();
  });
});
