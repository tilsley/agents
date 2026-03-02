import { describe, expect, test, mock } from "bun:test";
import { CopilotReviewerAdapter } from "../../src/adapters/llm/copilot-reviewer.adapter";
import type { ChatCompletionPort, ReviewChecklist } from "@tilsley/shared";
import type { ReviewerLlmContext } from "../../src/application/ports/reviewer-llm.port";

const DEFAULT_CHECKLIST: ReviewChecklist = {
  taskType: "feature",
  items: [
    { id: "quality", label: "Code Quality", description: "Clean code", weight: 1 },
  ],
};

function makeContext(overrides: Partial<ReviewerLlmContext> = {}): ReviewerLlmContext {
  return {
    prTitle: "Test PR",
    prBody: "Test body",
    diff: "diff --git a/test.ts b/test.ts\n+const x = 1;",
    checklist: DEFAULT_CHECKLIST,
    relevantLessons: [],
    ...overrides,
  };
}

describe("CopilotReviewerAdapter", () => {
  test("parses valid JSON array response", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            { itemId: "quality", label: "Code Quality", score: 85, reasoning: "Good" },
          ])
        )
      ),
    };

    const adapter = new CopilotReviewerAdapter(chatCompletion);
    const result = await adapter.evaluateChecklist(makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(85);
    expect(result[0].itemId).toBe("quality");
  });

  test("clamps scores to 0-100", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            { itemId: "quality", label: "Quality", score: 150, reasoning: "test" },
          ])
        )
      ),
    };

    const adapter = new CopilotReviewerAdapter(chatCompletion);
    const result = await adapter.evaluateChecklist(makeContext());

    expect(result[0].score).toBe(100);
  });

  test("handles parse failure with fallback scores", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() => Promise.resolve("I can't generate JSON")),
    };

    const adapter = new CopilotReviewerAdapter(chatCompletion);
    const result = await adapter.evaluateChecklist(makeContext());

    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(50);
    expect(result[0].itemId).toBe("quality");
  });

  test("includes diff in user message", async () => {
    const completeFn = mock(() =>
      Promise.resolve(JSON.stringify([{ itemId: "quality", score: 80 }]))
    );
    const chatCompletion: ChatCompletionPort = { complete: completeFn };

    const adapter = new CopilotReviewerAdapter(chatCompletion);
    await adapter.evaluateChecklist(makeContext({ diff: "+const myVar = 42;" }));

    const messages = completeFn.mock.calls[0][0];
    expect(messages[1].content).toContain("myVar");
  });

  test("includes lessons in user message when provided", async () => {
    const completeFn = mock(() =>
      Promise.resolve(JSON.stringify([{ itemId: "quality", score: 80 }]))
    );
    const chatCompletion: ChatCompletionPort = { complete: completeFn };

    const adapter = new CopilotReviewerAdapter(chatCompletion);
    await adapter.evaluateChecklist(
      makeContext({
        relevantLessons: [
          {
            problem: "Missing null check",
            solution: "Add guard clause",
            context: "API handler",
            outcome: "Fixed crash",
            tags: ["safety"],
            metadata: {},
          },
        ],
      })
    );

    const messages = completeFn.mock.calls[0][0];
    expect(messages[1].content).toContain("Missing null check");
    expect(messages[1].content).toContain("Add guard clause");
  });
});
