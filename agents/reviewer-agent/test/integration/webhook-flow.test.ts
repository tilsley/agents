import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test";
import { createHmac } from "crypto";
import { createWebhookServer } from "../../src/adapters/http/webhook.server";
import { HandleCheckRunCompleted } from "../../src/application/use-cases/handle-check-run-completed";
import { HandlePrEval } from "../../src/application/use-cases/handle-pr-eval";
import { DebounceBuffer } from "../../src/adapters/state/debounce-buffer";
import type { CheckRunEvent } from "../../src/application/use-cases/handle-check-run-completed";
import type { GitHubPort } from "../../src/application/ports/github.port";
import type { LlmPort } from "../../src/application/ports/llm.port";
import type { RerunTrackerPort } from "../../src/application/ports/rerun-tracker.port";
import type { PullRequest } from "../../src/domain/entities/pull-request";
import type { ReviewDecision } from "../../src/domain/entities/review-decision";

const WEBHOOK_SECRET = "test-secret";
const BOT_USERNAME = "my-bot[bot]";

function sign(payload: string): string {
  return (
    "sha256=" +
    createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")
  );
}

function makeCheckRunPayload(overrides: {
  conclusion?: string;
  action?: string;
  checkRunId?: number;
  checkName?: string;
  headSha?: string;
} = {}) {
  return {
    action: overrides.action ?? "completed",
    check_run: {
      id: overrides.checkRunId ?? 99001,
      name: overrides.checkName ?? "ci/build",
      status: "completed",
      conclusion: overrides.conclusion ?? "failure",
      head_sha: overrides.headSha ?? "e2e-sha-123",
      output: {
        title: "Build failed",
        summary: "Compilation error in main.ts",
        text: "error TS2345: Argument of type 'string' is not assignable",
      },
      check_suite: { id: 1 },
      app: { id: 1, slug: "github-actions" },
      pull_requests: [],
    },
    repository: {
      id: 1,
      name: "test-repo",
      full_name: "test-org/test-repo",
      owner: { login: "test-org" },
    },
    sender: { login: "github-actions[bot]" },
  };
}

function createMockRerunTracker(count: number = 0): RerunTrackerPort {
  return {
    getCount: mock(() => count),
    increment: mock(() => count + 1),
  };
}

function buildMocks(opts: {
  pr?: PullRequest | null;
  decisions?: ReviewDecision[];
} = {}) {
  const pr: PullRequest = opts.pr ?? {
    owner: "test-org",
    repo: "test-repo",
    number: 7,
    title: "Bump deps",
    body: "Automated update",
    author: BOT_USERNAME,
  };

  const decisions: ReviewDecision[] = opts.decisions ?? [
    {
      action: "rerun",
      reason: "Looks like a flaky timeout",
      checkRunId: 99001,
    },
  ];

  const github: GitHubPort = {
    getPullRequestForCheckRun: mock(() => Promise.resolve(pr)),
    getCheckRunAnnotations: mock(() => Promise.resolve("")),
    getCheckRunLog: mock(() => Promise.resolve("some log")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() =>
      Promise.resolve([
        { id: 1, name: "ci/tests", status: "completed", conclusion: "success" },
      ])
    ),
    getPullRequestDiff: mock(() => Promise.resolve("diff content")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
  };

  const llm: LlmPort = {
    analyzeCheckFailure: mock(() => Promise.resolve(decisions)),
    evaluatePullRequest: mock(() =>
      Promise.resolve({
        score: 85,
        summary: "Good quality",
        breakdown: [{ criterion: "Quality", score: 85, reasoning: "Clean" }],
      })
    ),
  };

  const rerunTracker = createMockRerunTracker();

  return { github, llm, rerunTracker };
}

async function sendWebhook(
  baseUrl: string,
  payload: object,
  event = "check_run"
) {
  const body = JSON.stringify(payload);
  return fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-Hub-Signature-256": sign(body),
      "X-GitHub-Delivery": crypto.randomUUID(),
    },
    body,
  });
}

describe("webhook integration", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let mocks: ReturnType<typeof buildMocks>;

  beforeAll(() => {
    mocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      mocks.github,
      mocks.llm,
      BOT_USERNAME,
      mocks.rerunTracker
    );
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
    });
    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop();
  });

  test("GET /health returns ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("rejects invalid signature", async () => {
    const body = JSON.stringify(makeCheckRunPayload());
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "check_run",
        "X-Hub-Signature-256": "sha256=invalid",
        "X-GitHub-Delivery": crypto.randomUUID(),
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  test("ignores non-check_run events", async () => {
    const res = await sendWebhook(baseUrl, { action: "opened" }, "pull_request");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("ignored");
  });

  test("ignores non-completed check_run actions", async () => {
    const res = await sendWebhook(
      baseUrl,
      makeCheckRunPayload({ action: "created" })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("ignored");
  });

  test("processes failed check_run and triggers rerun", async () => {
    const freshMocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(url, makeCheckRunPayload());
      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: string };
      expect(json.status).toBe("processing");

      await Bun.sleep(50);

      expect(freshMocks.github.getPullRequestForCheckRun).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        "e2e-sha-123"
      );
      expect(freshMocks.llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
      expect(freshMocks.github.rerunCheckRun).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        99001
      );
    } finally {
      srv.stop();
    }
  });

  test("processes failed check_run and closes PR", async () => {
    const freshMocks = buildMocks({
      decisions: [
        {
          action: "close",
          reason: "Legitimate type error introduced by the PR",
          checkRunId: 99001,
        },
      ],
    });
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(url, makeCheckRunPayload());
      expect(res.status).toBe(200);

      await Bun.sleep(50);

      expect(freshMocks.github.closePullRequest).toHaveBeenCalledWith(
        "test-org",
        "test-repo",
        7,
        "Legitimate type error introduced by the PR"
      );
      expect(freshMocks.github.rerunCheckRun).not.toHaveBeenCalled();
    } finally {
      srv.stop();
    }
  });

  test("skips processing when PR author is not the bot", async () => {
    const freshMocks = buildMocks({
      pr: {
        owner: "test-org",
        repo: "test-repo",
        number: 7,
        title: "Human PR",
        body: "",
        author: "some-human",
      },
    });
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(url, makeCheckRunPayload());
      expect(res.status).toBe(200);

      await Bun.sleep(50);

      expect(freshMocks.llm.analyzeCheckFailure).not.toHaveBeenCalled();
      expect(freshMocks.github.rerunCheckRun).not.toHaveBeenCalled();
      expect(freshMocks.github.closePullRequest).not.toHaveBeenCalled();
    } finally {
      srv.stop();
    }
  });

  test("batches rapid webhooks with event buffer", async () => {
    const freshMocks = buildMocks({
      decisions: [
        { action: "rerun", reason: "flaky test", checkRunId: 99001 },
        { action: "rerun", reason: "flaky lint", checkRunId: 99002 },
      ],
    });
    const eventBuffer = new DebounceBuffer<CheckRunEvent>(100);
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
      eventBuffer,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      // Send two webhooks for the same SHA rapidly
      await sendWebhook(
        url,
        makeCheckRunPayload({ checkRunId: 99001, checkName: "ci/tests" })
      );
      await sendWebhook(
        url,
        makeCheckRunPayload({ checkRunId: 99002, checkName: "ci/lint" })
      );

      // Wait for debounce window to flush
      await Bun.sleep(200);

      // Should have batched into a single LLM call
      expect(freshMocks.llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
      // Both checks should have been rerun
      expect(freshMocks.github.rerunCheckRun).toHaveBeenCalledTimes(2);
    } finally {
      eventBuffer.dispose();
      srv.stop();
    }
  });
});

describe("webhook eval integration", () => {
  test("success event routes to eval use case", async () => {
    const freshMocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const evalUseCase = new HandlePrEval(freshMocks.github, freshMocks.llm, {
      botUsername: BOT_USERNAME,
      evalPrompt: "Evaluate quality",
      thresholds: { approveAbove: 80, requestChangesBelow: 40 },
    });
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
      evalUseCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(
        url,
        makeCheckRunPayload({ conclusion: "success" })
      );
      expect(res.status).toBe(200);

      await Bun.sleep(50);

      // Eval should have been triggered
      expect(freshMocks.llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
      expect(freshMocks.github.commentOnPullRequest).toHaveBeenCalledTimes(1);
      // Score 85 >= 80 threshold → approve
      expect(freshMocks.github.approvePullRequest).toHaveBeenCalledTimes(1);
    } finally {
      srv.stop();
    }
  });

  test("failure event does not route to eval", async () => {
    const freshMocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const evalUseCase = new HandlePrEval(freshMocks.github, freshMocks.llm, {
      botUsername: BOT_USERNAME,
      evalPrompt: "Evaluate quality",
      thresholds: { approveAbove: 80, requestChangesBelow: 40 },
    });
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
      evalUseCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(
        url,
        makeCheckRunPayload({ conclusion: "failure" })
      );
      expect(res.status).toBe(200);

      await Bun.sleep(50);

      // Eval should NOT have been triggered
      expect(freshMocks.llm.evaluatePullRequest).not.toHaveBeenCalled();
    } finally {
      srv.stop();
    }
  });

  test("batches rapid success webhooks for eval", async () => {
    const freshMocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    const evalUseCase = new HandlePrEval(freshMocks.github, freshMocks.llm, {
      botUsername: BOT_USERNAME,
      evalPrompt: "Evaluate quality",
      thresholds: { approveAbove: 80, requestChangesBelow: 40 },
    });
    const evalEventBuffer = new DebounceBuffer<CheckRunEvent>(100);
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
      evalUseCase,
      evalEventBuffer,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      await sendWebhook(
        url,
        makeCheckRunPayload({
          conclusion: "success",
          checkRunId: 99001,
          checkName: "ci/tests",
        })
      );
      await sendWebhook(
        url,
        makeCheckRunPayload({
          conclusion: "success",
          checkRunId: 99002,
          checkName: "ci/lint",
        })
      );

      await Bun.sleep(200);

      // Should batch into single eval
      expect(freshMocks.llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
      expect(freshMocks.github.commentOnPullRequest).toHaveBeenCalledTimes(1);
    } finally {
      evalEventBuffer.dispose();
      srv.stop();
    }
  });

  test("no eval when eval use case not configured", async () => {
    const freshMocks = buildMocks();
    const useCase = new HandleCheckRunCompleted(
      freshMocks.github,
      freshMocks.llm,
      BOT_USERNAME,
      freshMocks.rerunTracker
    );
    // No evalUseCase provided
    const app = createWebhookServer({
      webhookSecret: WEBHOOK_SECRET,
      useCase,
    });
    const srv = Bun.serve({ port: 0, fetch: app.fetch });
    const url = `http://localhost:${srv.port}`;

    try {
      const res = await sendWebhook(
        url,
        makeCheckRunPayload({ conclusion: "success" })
      );
      expect(res.status).toBe(200);

      await Bun.sleep(50);

      expect(freshMocks.llm.evaluatePullRequest).not.toHaveBeenCalled();
    } finally {
      srv.stop();
    }
  });
});
