import { describe, expect, test, mock } from "bun:test";
import {
  HandleCheckRunCompleted,
  type CheckRunEvent,
} from "../../src/application/use-cases/handle-check-run-completed";
import type { GitHubPort } from "../../src/application/ports/github.port";
import type { LlmPort } from "../../src/application/ports/llm.port";
import type { RerunTrackerPort } from "../../src/application/ports/rerun-tracker.port";
import type { PullRequest } from "../../src/domain/entities/pull-request";
import type { CheckRun } from "../../src/domain/entities/check-run";
import type { ReviewDecision } from "../../src/domain/entities/review-decision";

const BOT = "my-bot[bot]";

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    owner: "test-org",
    repo: "test-repo",
    number: 42,
    title: "Update dependencies",
    body: "Automated dependency update",
    author: BOT,
    ...overrides,
  };
}

function makeCheckRun(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 1001,
    name: "ci/tests",
    status: "completed",
    conclusion: "failure",
    headSha: "abc123",
    output: { title: "Tests failed", summary: "2 failures", text: null },
    ...overrides,
  };
}

function makeEvent(checkRun?: Partial<CheckRun>): CheckRunEvent {
  const cr = makeCheckRun(checkRun);
  return { owner: "test-org", repo: "test-repo", checkRun: cr };
}

function createMockGitHub(pr: PullRequest | null = makePr()): GitHubPort {
  return {
    getPullRequestForCheckRun: mock(() => Promise.resolve(pr)),
    getCheckRunAnnotations: mock(() => Promise.resolve("annotation details")),
    getCheckRunLog: mock(() => Promise.resolve("log output here")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() => Promise.resolve([])),
    getPullRequestDiff: mock(() => Promise.resolve("")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
  };
}

function createMockLlm(
  decisions: ReviewDecision[] = [
    { action: "rerun", reason: "mock rerun reason", checkRunId: 1001 },
  ]
): LlmPort {
  return {
    analyzeCheckFailure: mock(() => Promise.resolve(decisions)),
    evaluatePullRequest: mock(() =>
      Promise.resolve({ score: 50, summary: "stub", breakdown: [] })
    ),
  };
}

function createMockRerunTracker(count: number = 0): RerunTrackerPort {
  return {
    getCount: mock(() => count),
    increment: mock(() => count + 1),
  };
}

describe("HandleCheckRunCompleted", () => {
  test("skips when no PR found for check run", async () => {
    const github = createMockGitHub(null);
    const llm = createMockLlm();
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(github.getPullRequestForCheckRun).toHaveBeenCalledTimes(1);
    expect(llm.analyzeCheckFailure).not.toHaveBeenCalled();
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
    expect(github.closePullRequest).not.toHaveBeenCalled();
  });

  test("skips non-bot PRs", async () => {
    const github = createMockGitHub(makePr({ author: "human-user" }));
    const llm = createMockLlm();
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(llm.analyzeCheckFailure).not.toHaveBeenCalled();
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("skips successful checks", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent({ conclusion: "success" }));

    expect(llm.analyzeCheckFailure).not.toHaveBeenCalled();
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("reruns check when LLM decides flaky", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "mock rerun reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
    expect(github.rerunCheckRun).toHaveBeenCalledWith(
      "test-org",
      "test-repo",
      1001
    );
    expect(github.closePullRequest).not.toHaveBeenCalled();
  });

  test("closes PR when LLM decides legitimate failure", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "close", reason: "mock close reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
    expect(github.closePullRequest).toHaveBeenCalledWith(
      "test-org",
      "test-repo",
      42,
      "mock close reason"
    );
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("does nothing when LLM decides skip", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "skip", reason: "mock skip reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
    expect(github.closePullRequest).not.toHaveBeenCalled();
  });

  test("passes correct context to LLM", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(llm.analyzeCheckFailure).toHaveBeenCalledWith({
      prTitle: "Update dependencies",
      prBody: "Automated dependency update",
      checks: [
        {
          checkName: "ci/tests",
          checkRunId: 1001,
          checkOutput: expect.stringContaining("Tests failed"),
          checkLog: "log output here",
        },
      ],
    });
  });

  test("increments rerun tracker when rerunning", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "mock rerun reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    expect(tracker.increment).toHaveBeenCalledTimes(1);
    expect(github.rerunCheckRun).toHaveBeenCalled();
  });

  test("escalates to close when rerun limit reached", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "mock rerun reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(3); // at limit
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker, 3);

    await useCase.execute(makeEvent());

    expect(github.rerunCheckRun).not.toHaveBeenCalled();
    expect(github.closePullRequest).toHaveBeenCalledWith(
      "test-org",
      "test-repo",
      42,
      expect.stringContaining("Rerun limit reached")
    );
    expect(tracker.increment).not.toHaveBeenCalled();
  });

  test("does not escalate when below rerun limit", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "mock rerun reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(2); // below limit of 3
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker, 3);

    await useCase.execute(makeEvent());

    expect(github.rerunCheckRun).toHaveBeenCalled();
    expect(github.closePullRequest).not.toHaveBeenCalled();
    expect(tracker.increment).toHaveBeenCalledTimes(1);
  });

  test("does not check rerun tracker for non-rerun decisions", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "close", reason: "mock close reason", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(10);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker, 3);

    await useCase.execute(makeEvent());

    expect(tracker.getCount).not.toHaveBeenCalled();
    expect(tracker.increment).not.toHaveBeenCalled();
  });
});

describe("HandleCheckRunCompleted batch", () => {
  test("processes multiple checks with single LLM call", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "flaky test", checkRunId: 1001 },
      { action: "skip", reason: "unclear", checkRunId: 1002 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    const events: CheckRunEvent[] = [
      makeEvent({ id: 1001, name: "ci/tests" }),
      makeEvent({ id: 1002, name: "ci/lint" }),
    ];

    await useCase.executeBatch(events);

    expect(llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
    expect(github.rerunCheckRun).toHaveBeenCalledWith(
      "test-org",
      "test-repo",
      1001
    );
    expect(github.closePullRequest).not.toHaveBeenCalled();
  });

  test("close decision stops processing remaining decisions", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "close", reason: "legit failure", checkRunId: 1001 },
      { action: "rerun", reason: "flaky", checkRunId: 1002 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    const events: CheckRunEvent[] = [
      makeEvent({ id: 1001, name: "ci/tests" }),
      makeEvent({ id: 1002, name: "ci/lint" }),
    ];

    await useCase.executeBatch(events);

    expect(github.closePullRequest).toHaveBeenCalledTimes(1);
    // Second rerun should NOT have been processed
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("empty batch does nothing", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const tracker = createMockRerunTracker();
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.executeBatch([]);

    expect(github.getPullRequestForCheckRun).not.toHaveBeenCalled();
    expect(llm.analyzeCheckFailure).not.toHaveBeenCalled();
  });

  test("execute delegates to executeBatch", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "mock rerun", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    await useCase.execute(makeEvent());

    // Should still work as single event through executeBatch
    expect(llm.analyzeCheckFailure).toHaveBeenCalledTimes(1);
    expect(github.rerunCheckRun).toHaveBeenCalledWith(
      "test-org",
      "test-repo",
      1001
    );
  });

  test("filters non-actionable checks in batch", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm([
      { action: "rerun", reason: "flaky", checkRunId: 1001 },
    ]);
    const tracker = createMockRerunTracker(0);
    const useCase = new HandleCheckRunCompleted(github, llm, BOT, tracker);

    const events: CheckRunEvent[] = [
      makeEvent({ id: 1001, name: "ci/tests", conclusion: "failure" }),
      makeEvent({ id: 1002, name: "ci/lint", conclusion: "success" }),
    ];

    await useCase.executeBatch(events);

    // LLM should only see the failure, not the success
    expect(llm.analyzeCheckFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: [
          expect.objectContaining({ checkRunId: 1001 }),
        ],
      })
    );
  });
});
