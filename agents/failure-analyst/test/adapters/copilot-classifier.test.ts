import { describe, expect, test, mock } from "bun:test";
import { CopilotClassifierAdapter } from "../../src/adapters/llm/copilot-classifier.adapter";
import type { ChatCompletionPort } from "@tilsley/shared";
import type { ClassificationContext } from "../../src/application/ports/classifier-llm.port";

function makeContext(overrides: Partial<ClassificationContext> = {}): ClassificationContext {
  return {
    checkName: "ci/tests",
    checkRunId: 1001,
    checkOutput: "Tests failed: 2 errors",
    checkLog: "Error: test timeout",
    prTitle: "Update deps",
    prBody: "Automated update",
    ...overrides,
  };
}

describe("CopilotClassifierAdapter", () => {
  test("parses valid JSON array response", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            {
              checkRunId: 1001,
              category: "infra_flake",
              errorType: "timeout",
              errorPattern: "test timeout",
              confidence: 0.85,
              reasoning: "Timeout indicates flaky test",
            },
          ])
        )
      ),
    };

    const adapter = new CopilotClassifierAdapter(chatCompletion);
    const results = await adapter.classifyFailures([makeContext()]);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("infra_flake");
    expect(results[0].confidence).toBe(0.85);
    expect(results[0].checkRunId).toBe(1001);
  });

  test("returns unknown for invalid category", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            {
              checkRunId: 1001,
              category: "invalid_category",
              errorType: "test",
              confidence: 0.9,
              reasoning: "test",
            },
          ])
        )
      ),
    };

    const adapter = new CopilotClassifierAdapter(chatCompletion);
    const results = await adapter.classifyFailures([makeContext()]);

    expect(results[0].category).toBe("unknown");
  });

  test("clamps confidence to [0, 1]", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() =>
        Promise.resolve(
          JSON.stringify([
            { checkRunId: 1001, category: "code_bug", confidence: 1.5 },
          ])
        )
      ),
    };

    const adapter = new CopilotClassifierAdapter(chatCompletion);
    const results = await adapter.classifyFailures([makeContext()]);

    expect(results[0].confidence).toBe(1);
  });

  test("handles parse failure gracefully", async () => {
    const chatCompletion: ChatCompletionPort = {
      complete: mock(() => Promise.resolve("I cannot parse this")),
    };

    const adapter = new CopilotClassifierAdapter(chatCompletion);
    const results = await adapter.classifyFailures([makeContext()]);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe("unknown");
    expect(results[0].confidence).toBe(0);
  });

  test("passes correct messages to ChatCompletionPort", async () => {
    const completeFn = mock(() =>
      Promise.resolve(JSON.stringify([{ checkRunId: 1001, category: "unknown" }]))
    );
    const chatCompletion: ChatCompletionPort = { complete: completeFn };

    const adapter = new CopilotClassifierAdapter(chatCompletion);
    await adapter.classifyFailures([makeContext({ prTitle: "My PR Title" })]);

    expect(completeFn).toHaveBeenCalledTimes(1);
    const messages = completeFn.mock.calls[0][0];
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("My PR Title");
  });
});
