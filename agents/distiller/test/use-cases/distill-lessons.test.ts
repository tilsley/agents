import { describe, expect, test, mock } from "bun:test";
import {
  DistillLessons,
  type DistillLessonsInput,
} from "../../src/application/use-cases/distill-lessons";
import type { MemoryPort, Lesson, PullRequest } from "@tilsley/shared";
import type { SummarizerLlmPort } from "../../src/application/ports/summarizer-llm.port";
import type { ConsolidatorLlmPort, ConsolidationResult } from "../../src/application/ports/consolidator-llm.port";
import type { ConductorPort } from "../../src/application/ports/conductor.port";
import type { PipelineSummary } from "../../src/domain/entities/pipeline-summary";

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    owner: "test-org",
    repo: "test-repo",
    number: 42,
    title: "Fix auth bug",
    body: "Fixes the login issue",
    author: "dev",
    ...overrides,
  };
}

function makeSummary(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    pullRequest: makePr(),
    headSha: "abc123",
    failureSignatures: [],
    reviewScore: 85,
    reviewDecision: "approve",
    reviewFeedback: "Looks good",
    diff: "+const fix = true;",
    metadata: {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<DistillLessonsInput> = {}): DistillLessonsInput {
  return {
    summary: makeSummary(),
    correlationId: "corr-1",
    ...overrides,
  };
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    problem: "Flaky tests causing CI failures regularly",
    solution: "Added retry logic with exponential backoff",
    context: "CI pipeline for main branch",
    outcome: "Reduced flake rate by 90%",
    tags: ["ci", "testing"],
    metadata: {},
    ...overrides,
  };
}

function createMockSummarizer(
  lessons: Lesson[] = [makeLesson()]
): SummarizerLlmPort {
  return {
    summarize: mock(() => Promise.resolve(lessons)),
  };
}

function createMockMemory(): MemoryPort {
  return {
    search: mock(() => Promise.resolve([])),
    list: mock(() => Promise.resolve([])),
    store: mock(() => Promise.resolve()),
    replace: mock(() => Promise.resolve()),
  };
}

function createMockConsolidator(): ConsolidatorLlmPort {
  return {
    consolidate: mock((_existing: unknown, incoming: Lesson[]): Promise<ConsolidationResult> =>
      Promise.resolve({ repo: incoming, global: [] })
    ),
  };
}

function createMockConductor(): ConductorPort {
  return {
    emit: mock(() => Promise.resolve()),
  };
}

describe("DistillLessons", () => {
  test("stores quality lessons via MemoryPort", async () => {
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(createMockSummarizer(), createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(1);
    expect(memory.replace).toHaveBeenCalledTimes(1);
  });

  test("filters out low-quality lessons", async () => {
    const summarizer = createMockSummarizer([
      makeLesson({ problem: "short", solution: "fix", tags: [] }),
    ]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(0);
    expect(result.filteredCount).toBe(1);
    expect(memory.replace).not.toHaveBeenCalled();
  });

  test("removes duplicate lessons", async () => {
    const summarizer = createMockSummarizer([
      makeLesson(),
      makeLesson(), // exact duplicate
    ]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(1);
  });

  test("emits distillation.completed event", async () => {
    const conductor = createMockConductor();
    const useCase = new DistillLessons(createMockSummarizer(), createMockConsolidator(), createMockMemory(), conductor);

    await useCase.execute(makeInput());

    expect(conductor.emit).toHaveBeenCalledTimes(1);
    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.type).toBe("distillation.completed");
    expect(event.payload.lessonsStored).toBe(1);
  });

  test("handles empty lesson list from LLM", async () => {
    const summarizer = createMockSummarizer([]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(0);
    expect(result.lessons).toHaveLength(0);
    expect(memory.replace).not.toHaveBeenCalled();
  });

  test("excludes lessons with empty problem", async () => {
    const summarizer = createMockSummarizer([
      makeLesson({ problem: "" }),
    ]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(0);
  });

  test("preserves correlationId in emitted event", async () => {
    const conductor = createMockConductor();
    const useCase = new DistillLessons(createMockSummarizer(), createMockConsolidator(), createMockMemory(), conductor);

    await useCase.execute(makeInput({ correlationId: "my-corr" }));

    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.correlationId).toBe("my-corr");
  });

  test("passes summary to LLM", async () => {
    const summarizer = createMockSummarizer();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), createMockMemory(), createMockConductor());

    const summary = makeSummary({ reviewScore: 42 });
    await useCase.execute(makeInput({ summary }));

    const passedContext = (summarizer.summarize as ReturnType<typeof mock>).mock.calls[0][0];
    expect(passedContext.reviewScore).toBe(42);
  });

  test("stores multiple quality lessons", async () => {
    const summarizer = createMockSummarizer([
      makeLesson({ problem: "Problem A is a longer description" }),
      makeLesson({ problem: "Problem B is another description" }),
    ]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    expect(result.storedCount).toBe(2);
    expect(result.lessons).toHaveLength(2);
  });

  test("includes owner and repo in emitted event", async () => {
    const conductor = createMockConductor();
    const useCase = new DistillLessons(createMockSummarizer(), createMockConsolidator(), createMockMemory(), conductor);

    await useCase.execute(makeInput());

    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.payload.owner).toBe("test-org");
    expect(event.payload.repo).toBe("test-repo");
    expect(event.payload.prNumber).toBe(42);
  });

  test("returns filtered count correctly", async () => {
    const summarizer = createMockSummarizer([
      makeLesson(), // passes quality
      makeLesson({ problem: "short", solution: "s", tags: [] }), // fails: too short
    ]);
    const memory = createMockMemory();
    const conductor = createMockConductor();
    const useCase = new DistillLessons(summarizer, createMockConsolidator(), memory, conductor);

    const result = await useCase.execute(makeInput());

    // The second lesson has short problem/solution — quality check (min length 10 chars) will filter it
    expect(result.storedCount).toBe(1);
  });
});
