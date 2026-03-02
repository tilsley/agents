import { describe, expect, test, mock } from "bun:test";
import { AnalyzeFailure, type AnalyzeFailureInput } from "../../src/application/use-cases/analyze-failure";
import type { GitHubPort, PullRequest, CheckRun } from "@tilsley/shared";
import type { ClassifierLlmPort, ClassificationResult } from "../../src/application/ports/classifier-llm.port";
import type { ConductorPort } from "../../src/application/ports/conductor.port";
import type { RetryTrackerPort } from "../../src/adapters/state/in-memory-retry-tracker";

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    owner: "test-org",
    repo: "test-repo",
    number: 42,
    title: "Update dependencies",
    body: "Automated dependency update",
    author: "bot[bot]",
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

function makeInput(overrides: Partial<AnalyzeFailureInput> = {}): AnalyzeFailureInput {
  return {
    owner: "test-org",
    repo: "test-repo",
    headSha: "abc123",
    checkRuns: [makeCheckRun()],
    ...overrides,
  };
}

function createMockGitHub(pr: PullRequest | null = makePr()): GitHubPort {
  return {
    getPullRequestForCheckRun: mock(() => Promise.resolve(pr)),
    getCheckRunAnnotations: mock(() => Promise.resolve("annotation details")),
    getCheckRunLog: mock(() => Promise.resolve("log output")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() => Promise.resolve([])),
    getPullRequestDiff: mock(() => Promise.resolve("")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
    mergePullRequest: mock(() => Promise.resolve()),
  };
}

function createMockClassifier(
  results: ClassificationResult[] = [
    {
      checkRunId: 1001,
      category: "infra_flake",
      errorType: "timeout",
      errorPattern: "timed out",
      confidence: 0.85,
      reasoning: "Looks like a timeout",
    },
  ]
): ClassifierLlmPort {
  return {
    classifyFailures: mock(() => Promise.resolve(results)),
  };
}

function createMockConductor(): ConductorPort {
  return {
    emit: mock(() => Promise.resolve()),
  };
}

function createMockRetryTracker(count: number = 0): RetryTrackerPort {
  return {
    getCount: mock(() => count),
    increment: mock(() => count + 1),
  };
}

describe("AnalyzeFailure", () => {
  test("returns empty when no PR found", async () => {
    const github = createMockGitHub(null);
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(makeInput());

    expect(result).toEqual([]);
    expect(classifier.classifyFailures).not.toHaveBeenCalled();
    expect(conductor.emit).not.toHaveBeenCalled();
  });

  test("returns empty when no failed checks", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({ checkRuns: [makeCheckRun({ conclusion: "success" })] })
    );

    expect(result).toEqual([]);
    expect(classifier.classifyFailures).not.toHaveBeenCalled();
  });

  test("always calls LLM even when heuristic matches", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "connect ETIMEDOUT", text: null },
          }),
        ],
      })
    );

    expect(result).toHaveLength(1);
    // LLM IS called — heuristic is a hint, not a bypass
    expect(classifier.classifyFailures).toHaveBeenCalledTimes(1);
    // Heuristic hint should be passed to LLM context
    const contexts = (classifier.classifyFailures as ReturnType<typeof mock>).mock.calls[0][0];
    expect(contexts[0].heuristicHint).not.toBeNull();
    expect(contexts[0].heuristicHint?.errorType).toBe("network_error");
  });

  test("calls LLM for all failed checks with no heuristic match", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier([
      {
        checkRunId: 1001,
        category: "code_bug",
        errorType: "logic_error",
        errorPattern: "assertion",
        confidence: 0.75,
        reasoning: "Test assertion failed",
      },
    ]);
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "Test failed", summary: "Some custom error", text: null },
          }),
        ],
      })
    );

    expect(result).toHaveLength(1);
    expect(classifier.classifyFailures).toHaveBeenCalledTimes(1);
    expect(result[0].category).toBe("code_bug");
    expect(result[0].decision).toBe("route_to_fixer");
    // No heuristic hint for this one
    const contexts = (classifier.classifyFailures as ReturnType<typeof mock>).mock.calls[0][0];
    expect(contexts[0].heuristicHint).toBeNull();
  });

  test("uses unknown when LLM confidence below threshold", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier([
      {
        checkRunId: 1001,
        category: "code_bug",
        errorType: "unclear",
        errorPattern: "",
        confidence: 0.3, // below 0.6 threshold
        reasoning: "Not sure",
      },
    ]);
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "Weird error", summary: "something unusual", text: null },
          }),
        ],
      })
    );

    expect(result[0].category).toBe("unknown");
    expect(result[0].decision).toBe("skip");
  });

  test("emits event via conductor after analysis", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "network", text: null },
          }),
        ],
      })
    );

    expect(conductor.emit).toHaveBeenCalledTimes(1);
    const emittedEvent = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(emittedEvent.type).toBe("failure-analysis.completed");
    expect(emittedEvent.payload.prNumber).toBe(42);
  });

  test("retries infra_flake and increments tracker", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker(0);
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "network timeout", text: null },
          }),
        ],
      })
    );

    expect(github.rerunCheckRun).toHaveBeenCalledWith("test-org", "test-repo", 1001);
    expect(tracker.increment).toHaveBeenCalled();
  });

  test("escalates when retry limit reached", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker(3); // at limit
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker, 3);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "network", text: null },
          }),
        ],
      })
    );

    expect(result[0].decision).toBe("escalate");
    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("handles multiple checks — all go to LLM", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier([
      {
        checkRunId: 1001,
        category: "infra_flake",
        errorType: "network_error",
        errorPattern: "ETIMEDOUT",
        confidence: 0.9,
        reasoning: "Network error confirmed",
      },
      {
        checkRunId: 1002,
        category: "code_bug",
        errorType: "logic",
        errorPattern: "failed assertion",
        confidence: 0.8,
        reasoning: "Test logic error",
      },
    ]);
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker(0);
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            id: 1001,
            name: "ci/build",
            output: { title: "ETIMEDOUT", summary: "network", text: null },
          }),
          makeCheckRun({
            id: 1002,
            name: "ci/tests",
            output: { title: "Custom error", summary: "something else", text: null },
          }),
        ],
      })
    );

    // Both checks go to LLM
    expect(classifier.classifyFailures).toHaveBeenCalledTimes(1);
    const contexts = (classifier.classifyFailures as ReturnType<typeof mock>).mock.calls[0][0];
    expect(contexts).toHaveLength(2);

    expect(result).toHaveLength(2);
    const buildResult = result.find((r) => r.checkRunId === 1001);
    const testResult = result.find((r) => r.checkRunId === 1002);
    expect(buildResult!.category).toBe("infra_flake");
    expect(testResult!.category).toBe("code_bug");
  });

  test("handles timed_out conclusion as failed", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    const result = await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            conclusion: "timed_out",
            output: { title: "Timed out", summary: "timeout reached", text: null },
          }),
        ],
      })
    );

    expect(result).toHaveLength(1);
  });

  test("fetches annotations and logs for all failed checks", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier([
      {
        checkRunId: 1001,
        category: "unknown",
        errorType: "unclear",
        errorPattern: "",
        confidence: 0.5,
        reasoning: "unclear",
      },
    ]);
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "network", text: null },
          }),
        ],
      })
    );

    // Annotations and logs fetched even for heuristic-matched checks
    expect(github.getCheckRunAnnotations).toHaveBeenCalledWith("test-org", "test-repo", 1001);
    expect(github.getCheckRunLog).toHaveBeenCalledWith("test-org", "test-repo", 1001);
  });

  test("does not rerun code_bug checks", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier([
      {
        checkRunId: 1001,
        category: "code_bug",
        errorType: "type_error",
        errorPattern: "TypeError",
        confidence: 0.85,
        reasoning: "Type error in PR code",
      },
    ]);
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "TypeError: foo", summary: "type error", text: null },
          }),
        ],
      })
    );

    expect(github.rerunCheckRun).not.toHaveBeenCalled();
  });

  test("includes correlationId in emitted event", async () => {
    const github = createMockGitHub();
    const classifier = createMockClassifier();
    const conductor = createMockConductor();
    const tracker = createMockRetryTracker();
    const useCase = new AnalyzeFailure(github, classifier, conductor, tracker);

    await useCase.execute(
      makeInput({
        checkRuns: [
          makeCheckRun({
            output: { title: "ETIMEDOUT", summary: "network", text: null },
          }),
        ],
      })
    );

    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.correlationId).toBe("test-org/test-repo#42:abc123");
  });
});
