import { CopilotClient, defineTool, approveAll } from "@github/copilot-sdk";
import type { ReasoningEffort } from "@github/copilot-sdk";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  ChatMessage,
  ToolUseChatCompletionPort,
  ToolDefinition,
  ToolExecutor,
  CompleteWithToolsOptions,
  AgentSessionConfig,
  AgentSessionPort,
} from "@tilsley/shared";

/** Try direct parse first; fall back to regex extraction. */
function extractJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new SyntaxError("No JSON object found in response");
    return JSON.parse(match[0]) as T;
  }
}

/**
 * Resolve the native Copilot CLI binary for the current platform.
 * The SDK defaults to `index.js` which it runs via `process.execPath` (bun),
 * but `index.js` uses `node:sqlite` which Bun can't resolve. The native
 * binary avoids this entirely.
 *
 * Resolution chain: this package → copilot-sdk → @github/copilot → platform binary
 */
function getNativeCopilotCliPath(): string {
  const sdkPkg = createRequire(import.meta.url).resolve("@github/copilot-sdk/package.json");
  const copilotPkg = createRequire(sdkPkg).resolve("@github/copilot/package.json");
  const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
  const platformPkgJson = createRequire(copilotPkg).resolve(`${platformPkg}/package.json`);
  return join(dirname(platformPkgJson), "copilot" + (process.platform === "win32" ? ".exe" : ""));
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minutes — tool-use sessions need much more than the SDK's 60s default

/**
 * Copilot SDK adapter — the SDK handles tool-call loops server-side via
 * JSON-RPC to the Copilot CLI, so an entire tool-use conversation counts
 * as **one premium request** regardless of how many tool calls the model makes.
 */
export class CopilotSdkAdapter implements ToolUseChatCompletionPort, AgentSessionPort {
  private client: CopilotClient;
  private started = false;

  constructor(
    private model: string,
    private githubToken?: string,
    private reasoningEffort?: ReasoningEffort
  ) {
    this.client = new CopilotClient({ cliPath: getNativeCopilotCliPath() });
  }

  private async ensureStarted(): Promise<void> {
    if (!this.started) {
      await this.client.start();
      this.started = true;
    }
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    await this.ensureStarted();

    const { systemMessage, userContent } = extractMessages(messages);
    const debug = getDebugLevel();

    const session = await this.client.createSession({
      model: this.model,
      githubToken: this.githubToken,
      onPermissionRequest: approveAll,
      ...(this.reasoningEffort && { reasoningEffort: this.reasoningEffort }),
      ...(systemMessage && {
        systemMessage: { content: systemMessage },
      }),
    });

    if (debug) {
      attachReasoningLogger(session, debug);
    }

    try {
      const result = await session.sendAndWait({ prompt: userContent }, DEFAULT_TIMEOUT_MS);
      return result?.data?.content ?? "";
    } finally {
      await session.destroy();
    }
  }

  async completeJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
    const content = await this.complete(messages);
    return extractJson<T>(content);
  }

  async completeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    executor: ToolExecutor,
    _options?: CompleteWithToolsOptions
  ): Promise<string> {
    await this.ensureStarted();

    const { systemMessage, userContent } = extractMessages(messages);
    const debug = getDebugLevel();

    const sdkTools = tools.map((t) =>
      defineTool(t.function.name, {
        description: t.function.description,
        parameters: t.function.parameters,
        overridesBuiltInTool: true,
        handler: async (args: Record<string, unknown>) =>
          executor[t.function.name](args),
      })
    );

    // availableTools restricts the CLI to only our custom tools,
    // preventing its built-in tools (bash, grep, str_replace_editor, etc.)
    // from being sent to the API alongside ours.
    const toolNames = sdkTools.map((t) => t.name);

    const session = await this.client.createSession({
      model: this.model,
      githubToken: this.githubToken,
      onPermissionRequest: approveAll,
      tools: sdkTools,
      availableTools: toolNames,
      ...(this.reasoningEffort && { reasoningEffort: this.reasoningEffort }),
      ...(systemMessage && {
        systemMessage: { content: systemMessage },
      }),
    });

    if (debug) {
      attachReasoningLogger(session, debug);
      session.on((event) => {
        const data = event.data as Record<string, unknown>;
        switch (event.type) {
          case "tool.execution_start":
            console.log(`[copilot-sdk] tool-call: ${data.toolName}(${truncate(JSON.stringify(data.arguments ?? {}), 200)})`);
            break;
          case "tool.execution_complete": {
            const result = data as { success: boolean; toolCallId: string; result?: { content: string }; error?: { message: string } };
            if (result.success) {
              console.log(`[copilot-sdk] tool-result: ${result.toolCallId} → ${(result.result?.content ?? "").length} chars`);
            } else {
              console.log(`[copilot-sdk] tool-error: ${result.toolCallId} → ${result.error?.message}`);
            }
            break;
          }
          case "assistant.message":
            console.log(`[copilot-sdk] assistant: ${truncate(String(data.content ?? ""), 300)}`);
            break;
          case "assistant.usage":
            console.log(`[copilot-sdk] usage: model=${data.model} in=${data.inputTokens ?? "?"} out=${data.outputTokens ?? "?"}`);
            break;
          // reasoning events handled by attachReasoningLogger
          case "assistant.reasoning":
          case "assistant.reasoning_delta":
            break;
          default:
            console.log(`[copilot-sdk] ${event.type}: ${truncate(JSON.stringify(data), 300)}`);
            break;
        }
      });
    }

    try {
      const result = await session.sendAndWait({ prompt: userContent }, DEFAULT_TIMEOUT_MS);
      return result?.data?.content ?? "";
    } finally {
      await session.destroy();
    }
  }

  async runAgentSession(config: AgentSessionConfig): Promise<string> {
    await this.ensureStarted();

    const debug = getDebugLevel();
    const timeout = config.timeout ?? 10 * 60_000; // 10 minutes for agent sessions

    const session = await this.client.createSession({
      model: this.model,
      githubToken: this.githubToken,
      onPermissionRequest: approveAll,
      workingDirectory: config.workingDirectory,
      ...(config.availableTools && { availableTools: config.availableTools }),
      infiniteSessions: { enabled: true },
      ...(this.reasoningEffort && { reasoningEffort: this.reasoningEffort }),
      systemMessage: { content: config.systemPrompt },
    });

    if (debug) {
      attachReasoningLogger(session, debug);
      session.on((event) => {
        const data = event.data as Record<string, unknown>;
        switch (event.type) {
          case "tool.execution_start":
            console.log(`[copilot-sdk:agent] tool-call: ${data.toolName}(${truncate(JSON.stringify(data.arguments ?? {}), 200)})`);
            break;
          case "tool.execution_complete": {
            const result = data as { success: boolean; toolCallId: string; result?: { content: string }; error?: { message: string } };
            if (result.success) {
              console.log(`[copilot-sdk:agent] tool-result: ${result.toolCallId} → ${(result.result?.content ?? "").length} chars`);
            } else {
              console.log(`[copilot-sdk:agent] tool-error: ${result.toolCallId} → ${result.error?.message}`);
            }
            break;
          }
          case "assistant.message":
            console.log(`[copilot-sdk:agent] assistant: ${truncate(String(data.content ?? ""), 300)}`);
            break;
          case "assistant.usage":
            console.log(`[copilot-sdk:agent] usage: model=${data.model} in=${data.inputTokens ?? "?"} out=${data.outputTokens ?? "?"}`);
            break;
          case "assistant.reasoning":
          case "assistant.reasoning_delta":
            break;
          default:
            console.log(`[copilot-sdk:agent] ${event.type}: ${truncate(JSON.stringify(data), 300)}`);
            break;
        }
      });
    }

    try {
      const result = await session.sendAndWait({ prompt: config.userPrompt }, timeout);
      return result?.data?.content ?? "";
    } finally {
      await session.destroy();
    }
  }

  async stop(): Promise<void> {
    if (this.started) {
      await this.client.stop();
      this.started = false;
    }
  }
}

type DebugLevel = "summary" | "verbose";

function getDebugLevel(): DebugLevel | null {
  const val = process.env.LLM_DEBUG;
  if (!val) return null;
  if (val === "verbose") return "verbose";
  return "summary";
}

/**
 * Attach reasoning event listeners to a session.
 * - summary mode: logs a one-line summary with char count
 * - verbose mode: logs the full reasoning text
 */
function attachReasoningLogger(
  session: { on: (handler: (event: { type: string; data: unknown }) => void) => void },
  level: DebugLevel
): void {
  session.on((event) => {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case "assistant.reasoning": {
        const content = String(data.content ?? "");
        if (level === "verbose") {
          console.log(`[copilot-sdk] thinking:\n${content}`);
        } else {
          console.log(`[copilot-sdk] thinking: ${content.length} chars — ${truncate(content.split("\n")[0], 120)}`);
        }
        break;
      }
      case "assistant.reasoning_delta": {
        // Only log deltas in verbose mode to avoid noise
        if (level === "verbose") {
          const delta = String(data.deltaContent ?? "");
          process.stdout.write(delta);
        }
        break;
      }
    }
  });
}

function extractMessages(messages: ChatMessage[]): { systemMessage: string | undefined; userContent: string } {
  return {
    systemMessage: messages.find((m) => m.role === "system")?.content,
    userContent: messages
      .filter((m) => m.role !== "system")
      .map((m) => m.content)
      .join("\n\n"),
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
