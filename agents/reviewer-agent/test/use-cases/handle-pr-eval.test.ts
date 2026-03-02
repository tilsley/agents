import { describe, expect, test, mock } from "bun:test";
import {
  HandlePrEval,
  type HandlePrEvalConfig,
} from "../../src/application/use-cases/handle-pr-eval";
import type { CheckRunEvent } from "../../src/application/use-cases/handle-check-run-completed";
import type { GitHubPort } from "../../src/application/ports/github.port";
import type { LlmPort } from "../../src/application/ports/llm.port";
import type { PullRequest } from "../../src/domain/entities/pull-request";
import type { CheckRun } from "../../src/domain/entities/check-run";

const BOT = "my-bot[bot]";

const DEFAULT_CONFIG: HandlePrEvalConfig = {
  botUsername: BOT,
  evalPrompt: "Evaluate code quality",
  thresholds: { approveAbove: 80, requestChangesBelow: 40 },
};

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
    conclusion: "success",
    headSha: "abc123",
    output: { title: "Tests passed", summary: "All green", text: null },
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
    getCheckRunAnnotations: mock(() => Promise.resolve("")),
    getCheckRunLog: mock(() => Promise.resolve("")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() =>
      Promise.resolve([
        { id: 1, name: "ci/tests", status: "completed", conclusion: "success" },
        { id: 2, name: "ci/lint", status: "completed", conclusion: "success" },
      ])
    ),
    getPullRequestDiff: mock(() => Promise.resolve("diff --git a/file.ts b/file.ts\n+new line")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
  };
}

function createMockLlm(evalResult?: {
  score: number;
  summary: string;
  breakdown: Array<{ criterion: string; score: number; reasoning: string }>;
}): LlmPort {
  const defaultResult = {
    score: 85,
    summary: "Good quality PR",
    breakdown: [
      { criterion: "Code quality", score: 90, reasoning: "Clean code" },
    ],
  };
  return {
    analyzeCheckFailure: mock(() => Promise.resolve([])),
    evaluatePullRequest: mock(() =>
      Promise.resolve(evalResult ?? defaultResult)
    ),
  };
}

describe("HandlePrEval", () => {
  test("skips when no PR found", async () => {
    const github = createMockGitHub(null);
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(github.getPullRequestForCheckRun).toHaveBeenCalledTimes(1);
    expect(llm.evaluatePullRequest).not.toHaveBeenCalled();
  });

  test("skips non-bot PRs", async () => {
    const github = createMockGitHub(makePr({ author: "human-user" }));
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).not.toHaveBeenCalled();
  });

  test("skips when not all checks passed", async () => {
    const github = createMockGitHub();
    (github.getCheckRunsForRef as ReturnType<typeof mock>).mockImplementation(
      () =>
        Promise.resolve([
          { id: 1, name: "ci/tests", status: "completed", conclusion: "success" },
          { id: 2, name: "ci/lint", status: "in_progress", conclusion: null },
        ])
    );
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(github.getCheckRunsForRef).toHaveBeenCalledTimes(1);
    expect(llm.evaluatePullRequest).not.toHaveBeenCalled();
  });

  test("evaluates and approves high-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm({
      score: 90,
      summary: "Excellent quality",
      breakdown: [{ criterion: "Quality", score: 90, reasoning: "Great" }],
    });
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
    expect(github.requestChangesOnPullRequest).not.toHaveBeenCalled();
  });

  test("evaluates and requests changes for low-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm({
      score: 20,
      summary: "Poor quality",
      breakdown: [{ criterion: "Quality", score: 20, reasoning: "Bad" }],
    });
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(github.requestChangesOnPullRequest).toHaveBeenCalledTimes(1);
    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  test("evaluates and takes no action for mid-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm({
      score: 60,
      summary: "OK quality",
      breakdown: [],
    });
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.requestChangesOnPullRequest).not.toHaveBeenCalled();
  });

  test("truncates large diffs", async () => {
    const github = createMockGitHub();
    const largeDiff = "x".repeat(20000);
    (github.getPullRequestDiff as ReturnType<typeof mock>).mockImplementation(
      () => Promise.resolve(largeDiff)
    );
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, {
      ...DEFAULT_CONFIG,
      diffMaxLength: 500,
    });

    await useCase.execute(makeEvent());

    const call = (llm.evaluatePullRequest as ReturnType<typeof mock>).mock
      .calls[0];
    const context = call[0] as { prDiff: string };
    expect(context.prDiff.length).toBeLessThanOrEqual(500);
  });

  test("passes eval prompt to LLM context", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const config = { ...DEFAULT_CONFIG, evalPrompt: "Custom eval prompt" };
    const useCase = new HandlePrEval(github, llm, config);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        evalPrompt: "Custom eval prompt",
        prTitle: "Update dependencies",
        prBody: "Automated dependency update",
      })
    );
  });

  test("handles LLM error gracefully (fallback score)", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm({
      score: 50,
      summary: "LLM API error — defaulting to neutral score",
      breakdown: [],
    });
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    // Score of 50 is between thresholds, so no approve/request_changes
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
    expect(github.approvePullRequest).not.toHaveBeenCalled();
    expect(github.requestChangesOnPullRequest).not.toHaveBeenCalled();
  });
});

describe("HandlePrEval batch", () => {
  test("uses single API check for batched events", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    const events: CheckRunEvent[] = [
      makeEvent({ id: 1001, name: "ci/tests" }),
      makeEvent({ id: 1002, name: "ci/lint" }),
    ];

    await useCase.executeBatch(events);

    // Only one PR lookup and one getCheckRunsForRef call
    expect(github.getPullRequestForCheckRun).toHaveBeenCalledTimes(1);
    expect(github.getCheckRunsForRef).toHaveBeenCalledTimes(1);
    expect(llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
  });

  test("empty batch does nothing", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.executeBatch([]);

    expect(github.getPullRequestForCheckRun).not.toHaveBeenCalled();
  });

  test("execute delegates to executeBatch", async () => {
    const github = createMockGitHub();
    const llm = createMockLlm();
    const useCase = new HandlePrEval(github, llm, DEFAULT_CONFIG);

    await useCase.execute(makeEvent());

    expect(llm.evaluatePullRequest).toHaveBeenCalledTimes(1);
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
  });
});
