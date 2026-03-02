import { describe, expect, test, mock } from "bun:test";
import { CopilotSummarizerAdapter } from "../../src/adapters/llm/copilot-summarizer.adapter";
import type { ChatCompletionPort } from "@tilsley/shared";
import type { PipelineSummary } from "../../src/domain/entities/pipeline-summary";

function makeSummary(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    pullRequest: {
      owner: "org",
      repo: "repo",
      number: 1,
      title: "Fix bug",
      body: "Fixes issue",
      author: "dev",
    },
    headSha: "abc123",
    failureSignatures: [],
    reviewScore: 85,
    reviewDecision: "approve",
    reviewFeedback: "Good work",
    diff: "+const fix = true;",
    metadata: {},
    ...overrides,
  };
}

describe("CopilotSummarizerAdapter", () => {
  test("parses valid lesson array", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            {
              problem: "Flaky tests",
              solution: "Add retries",
              context: "CI",
              outcome: "Fixed",
              tags: ["testing"],
              metadata: {},
            },
          ])
        )
      ),
    };

    const adapter = new CopilotSummarizerAdapter(chatCompletion);
    const lessons = await adapter.summarize(makeSummary());

    expect(lessons).toHaveLength(1);
    expect(lessons[0].problem).toBe("Flaky tests");
    expect(lessons[0].tags).toEqual(["testing"]);
  });

  test("returns empty array on parse failure", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() => Promise.resolve("Nothing to report")),
    };

    const adapter = new CopilotSummarizerAdapter(chatCompletion);
    const lessons = await adapter.summarize(makeSummary());

    expect(lessons).toHaveLength(0);
  });

  test("handles missing fields with defaults", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(JSON.stringify([{ problem: "Test" }]))
      ),
    };

    const adapter = new CopilotSummarizerAdapter(chatCompletion);
    const lessons = await adapter.summarize(makeSummary());

    expect(lessons[0].solution).toBe("");
    expect(lessons[0].tags).toEqual([]);
  });

  test("includes failure signatures in user message", async () => {
    const completeFn = mock(() => Promise.resolve("[]"));
    const chatCompletion: ChatCompletionPort = { complete: completeFn };

    const adapter = new CopilotSummarizerAdapter(chatCompletion);
    await adapter.summarize(
      makeSummary({
        failureSignatures: [
          {
            checkName: "ci/tests",
            errorType: "timeout",
            errorPattern: "ETIMEDOUT",
            category: "infra_flake",
            confidence: 0.8,
          },
        ],
      })
    );

    const messages = completeFn.mock.calls[0][0];
    expect(messages[1].content).toContain("ci/tests");
    expect(messages[1].content).toContain("ETIMEDOUT");
  });

  test("includes review score in user message", async () => {
    const completeFn = mock(() => Promise.resolve("[]"));
    const chatCompletion: ChatCompletionPort = { complete: completeFn };

    const adapter = new CopilotSummarizerAdapter(chatCompletion);
    await adapter.summarize(makeSummary({ reviewScore: 42 }));

    const messages = completeFn.mock.calls[0][0];
    expect(messages[1].content).toContain("42/100");
  });
});
