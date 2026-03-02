import { describe, expect, test, mock } from "bun:test";
import {
  EvaluatePr,
  type EvaluatePrInput,
} from "../../src/application/use-cases/evaluate-pr";
import type { GitHubPort, PullRequest, ReviewChecklist } from "@tilsley/shared";
import type { ReviewerLlmPort } from "../../src/application/ports/reviewer-llm.port";
import type { KnowledgePort } from "../../src/application/ports/knowledge.port";
import type { ConductorPort } from "../../src/application/ports/conductor.port";
import type { ChecklistScore } from "../../src/domain/entities/review-result";

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    owner: "test-org",
    repo: "test-repo",
    number: 42,
    title: "Add feature",
    body: "Implements new feature",
    author: "dev",
    ...overrides,
  };
}

const DEFAULT_CHECKLIST: ReviewChecklist = {
  taskType: "feature",
  items: [
    { id: "quality", label: "Code Quality", description: "Clean code", weight: 2 },
    { id: "tests", label: "Tests", description: "Test coverage", weight: 1 },
  ],
};

function makeInput(overrides: Partial<EvaluatePrInput> = {}): EvaluatePrInput {
  return {
    owner: "test-org",
    repo: "test-repo",
    prNumber: 42,
    checklist: DEFAULT_CHECKLIST,
    correlationId: "corr-1",
    ...overrides,
  };
}

function createMockGitHub(pr: PullRequest | null = makePr()): GitHubPort {
  return {
    getPullRequestForCheckRun: mock(() => Promise.resolve(pr)),
    getCheckRunAnnotations: mock(() => Promise.resolve("")),
    getCheckRunLog: mock(() => Promise.resolve("")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() => Promise.resolve([])),
    getPullRequestDiff: mock(() => Promise.resolve("diff --git a/file.ts b/file.ts\n+const x = 1;")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
    mergePullRequest: mock(() => Promise.resolve()),
  };
}

function createMockReviewerLlm(
  scores: ChecklistScore[] = [
    { itemId: "quality", label: "Code Quality", score: 85, reasoning: "Good" },
    { itemId: "tests", label: "Tests", score: 75, reasoning: "Adequate" },
  ]
): ReviewerLlmPort {
  return {
    evaluateChecklist: mock(() => Promise.resolve(scores)),
  };
}

function createMockKnowledge(): KnowledgePort {
  return {
    findRelevantLessons: mock(() => Promise.resolve([])),
    findPastReviews: mock(() => Promise.resolve([])),
  };
}

function createMockConductor(): ConductorPort {
  return {
    emit: mock(() => Promise.resolve()),
  };
}

describe("EvaluatePr", () => {
  test("returns null when PR not found", async () => {
    const github = createMockGitHub(null);
    const useCase = new EvaluatePr(
      github,
      createMockReviewerLlm(),
      createMockKnowledge(),
      createMockConductor()
    );

    const result = await useCase.execute(makeInput());
    expect(result).toBeNull();
  });

  test("approves high-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 90, reasoning: "Excellent" },
      { itemId: "tests", label: "Tests", score: 85, reasoning: "Great" },
    ]);
    const conductor = createMockConductor();
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), conductor
    );

    const result = await useCase.execute(makeInput());

    expect(result).not.toBeNull();
    expect(result!.decision).toBe("approve");
    expect(result!.overallScore).toBeGreaterThanOrEqual(80);
    expect(github.approvePullRequest).toHaveBeenCalledTimes(1);
  });

  test("requests changes on low-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 20, reasoning: "Poor" },
      { itemId: "tests", label: "Tests", score: 10, reasoning: "Missing" },
    ]);
    const conductor = createMockConductor();
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), conductor
    );

    const result = await useCase.execute(makeInput());

    expect(result!.decision).toBe("request_changes");
    expect(github.requestChangesOnPullRequest).toHaveBeenCalledTimes(1);
  });

  test("escalates medium-scoring PR", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 60, reasoning: "Ok" },
      { itemId: "tests", label: "Tests", score: 50, reasoning: "Partial" },
    ]);
    const conductor = createMockConductor();
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), conductor
    );

    const result = await useCase.execute(makeInput());

    expect(result!.decision).toBe("escalate");
    expect(github.commentOnPullRequest).toHaveBeenCalledTimes(1);
  });

  test("emits review.completed event", async () => {
    const github = createMockGitHub();
    const conductor = createMockConductor();
    const useCase = new EvaluatePr(
      github, createMockReviewerLlm(), createMockKnowledge(), conductor
    );

    await useCase.execute(makeInput());

    expect(conductor.emit).toHaveBeenCalledTimes(1);
    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.type).toBe("review.completed");
    expect(event.payload.prNumber).toBe(42);
  });

  test("queries corporate memory for lessons", async () => {
    const github = createMockGitHub();
    const memory = createMockKnowledge();
    const useCase = new EvaluatePr(
      github, createMockReviewerLlm(), memory, createMockConductor()
    );

    await useCase.execute(makeInput());

    expect(memory.findRelevantLessons).toHaveBeenCalledTimes(1);
    expect(memory.findPastReviews).toHaveBeenCalledTimes(1);
  });

  test("passes checklist to LLM", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm();
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), createMockConductor()
    );

    await useCase.execute(makeInput());

    const context = (llm.evaluateChecklist as ReturnType<typeof mock>).mock.calls[0][0];
    expect(context.checklist.taskType).toBe("feature");
    expect(context.checklist.items).toHaveLength(2);
  });

  test("calculates weighted overall score", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 100, reasoning: "Perfect" },
      { itemId: "tests", label: "Tests", score: 0, reasoning: "None" },
    ]);
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), createMockConductor()
    );

    const result = await useCase.execute(makeInput());

    // quality (weight 2) = 100, tests (weight 1) = 0
    // (100*2 + 0*1) / (2+1) = 66.67 → 67
    expect(result!.overallScore).toBe(67);
  });

  test("includes checklist scores in result", async () => {
    const github = createMockGitHub();
    const useCase = new EvaluatePr(
      github, createMockReviewerLlm(), createMockKnowledge(), createMockConductor()
    );

    const result = await useCase.execute(makeInput());

    expect(result!.checklistScores).toHaveLength(2);
    expect(result!.checklistScores[0].itemId).toBe("quality");
  });

  test("respects custom thresholds", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 85, reasoning: "Good" },
      { itemId: "tests", label: "Tests", score: 85, reasoning: "Good" },
    ]);
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), createMockConductor(),
      { approveAbove: 90, rejectBelow: 30 }
    );

    const result = await useCase.execute(makeInput());

    expect(result!.overallScore).toBe(85);
    expect(result!.decision).toBe("escalate"); // 85 < 90
  });

  test("provides feedback for low scores", async () => {
    const github = createMockGitHub();
    const llm = createMockReviewerLlm([
      { itemId: "quality", label: "Code Quality", score: 30, reasoning: "Poor quality" },
      { itemId: "tests", label: "Tests", score: 90, reasoning: "Good tests" },
    ]);
    const useCase = new EvaluatePr(
      github, llm, createMockKnowledge(), createMockConductor()
    );

    const result = await useCase.execute(makeInput());

    expect(result!.feedback).toContain("Code Quality");
    expect(result!.feedback).toContain("Poor quality");
  });

  test("fetches diff for PR", async () => {
    const github = createMockGitHub();
    const useCase = new EvaluatePr(
      github, createMockReviewerLlm(), createMockKnowledge(), createMockConductor()
    );

    await useCase.execute(makeInput());

    expect(github.getPullRequestDiff).toHaveBeenCalledWith("test-org", "test-repo", 42);
  });

  test("includes correlationId in emitted event", async () => {
    const github = createMockGitHub();
    const conductor = createMockConductor();
    const useCase = new EvaluatePr(
      github, createMockReviewerLlm(), createMockKnowledge(), conductor
    );

    await useCase.execute(makeInput({ correlationId: "my-corr" }));

    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.correlationId).toBe("my-corr");
  });
});
