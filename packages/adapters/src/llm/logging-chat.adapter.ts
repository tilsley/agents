import type {
  ChatMessage,
  ToolUseChatCompletionPort,
  ToolDefinition,
  ToolExecutor,
  CompleteWithToolsOptions,
} from "@tilsley/shared";

type LogLevel = "summary" | "verbose";

/** summary: truncated inputs/outputs. verbose: full bodies. */
function getLogLevel(): LogLevel | null {
  const val = process.env.LLM_DEBUG;
  if (!val) return null;
  if (val === "verbose") return "verbose";
  return "summary";
}

/** Truncate for summary logging. verbose gets the full string. */
function trunc(s: string, level: LogLevel, max = 300): string {
  if (level === "verbose") return s;
  if (s.length <= max) return s;
  return s.slice(0, max) + `… (${s.length} chars total)`;
}

export class LoggingChatAdapter implements ToolUseChatCompletionPort {
  constructor(
    private inner: ToolUseChatCompletionPort,
    private label: string
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    const level = getLogLevel();
    if (!level) return this.inner.complete(messages);

    this.logMessages("complete", messages, level);
    const start = performance.now();

    const result = await this.inner.complete(messages);

    const elapsed = Math.round(performance.now() - start);
    this.log(`← complete response (${elapsed}ms)`);
    this.log(`  ${trunc(result, level)}`);

    return result;
  }

  async completeJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
    const level = getLogLevel();
    if (!level) return this.inner.completeJson<T>(messages);

    this.logMessages("completeJson", messages, level);
    const start = performance.now();

    const result = await this.inner.completeJson<T>(messages);

    const elapsed = Math.round(performance.now() - start);
    const json = JSON.stringify(result, null, 2);
    this.log(`← completeJson response (${elapsed}ms)`);
    this.log(`  ${trunc(json, level, 500)}`);

    return result;
  }

  async completeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    executor: ToolExecutor,
    options?: CompleteWithToolsOptions
  ): Promise<string> {
    const level = getLogLevel();
    if (!level) return this.inner.completeWithTools(messages, tools, executor, options);

    const toolNames = tools.map((t) => t.function.name);
    this.logMessages("completeWithTools", messages, level, `tools: [${toolNames.join(", ")}]`);
    const start = performance.now();

    // Wrap executor to log each tool call and result
    const loggingExecutor: ToolExecutor = {};
    for (const name of Object.keys(executor)) {
      loggingExecutor[name] = async (args: Record<string, unknown>) => {
        this.log(`  ⤷ tool-call: ${name}(${trunc(JSON.stringify(args), level, 200)})`);

        const result = await executor[name](args);

        const lines = result.split("\n").length;
        this.log(`  ⤶ tool-result: ${name} → ${lines} lines, ${result.length} chars`);
        if (level === "verbose") {
          this.log(`    ${result.slice(0, 3000)}${result.length > 3000 ? "\n    …(truncated)" : ""}`);
        }

        return result;
      };
    }

    const result = await this.inner.completeWithTools(messages, tools, loggingExecutor, options);

    const elapsed = Math.round(performance.now() - start);
    this.log(`← completeWithTools response (${elapsed}ms)`);
    this.log(`  ${trunc(result, level, 500)}`);

    return result;
  }

  private logMessages(method: string, messages: ChatMessage[], level: LogLevel, extra?: string): void {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    const suffix = extra ? ` | ${extra}` : "";
    this.log(`→ ${method} | ${messages.length} messages | ${totalChars} chars${suffix}`);
    for (const msg of messages) {
      this.log(`  [${msg.role}] ${trunc(msg.content, level)}`);
    }
  }

  private log(msg: string): void {
    console.log(`[${this.label}] ${msg}`);
  }
}
