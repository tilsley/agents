import type {
  ChatMessage,
  ToolUseChatCompletionPort,
  ToolDefinition,
  ToolCall,
  ToolExecutor,
  ToolUseMessage,
  CompleteWithToolsOptions,
} from "@tilsley/shared";

/** Try direct parse first; fall back to regex extraction if the API ignored response_format. */
function extractJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new SyntaxError("No JSON object found in response");
    return JSON.parse(match[0]) as T;
  }
}

export class CopilotChatAdapter implements ToolUseChatCompletionPort {
  constructor(
    private token: string,
    private model = "claude-sonnet-4.6",
    private endpoint = "https://api.githubcopilot.com/chat/completions"
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    return this.request(messages);
  }

  async completeJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
    const content = await this.request(messages, {
      response_format: { type: "json_object" },
    });
    return extractJson<T>(content);
  }

  async completeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    executor: ToolExecutor,
    options?: CompleteWithToolsOptions
  ): Promise<string> {
    const maxTurns = options?.maxTurns ?? 10;
    const conversation: ToolUseMessage[] = [...messages];
    const debug = !!process.env.LLM_DEBUG;
    let toolCallsMade = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      const result = await this.requestRaw(conversation, { tools });

      // If the model returned tool calls, execute them and continue
      if (result.tool_calls && result.tool_calls.length > 0) {
        toolCallsMade = true;
        if (debug) {
          const names = result.tool_calls.map((tc) => tc.function.name).join(", ");
          console.log(`[copilot-chat] turn ${turn}: tool-calls [${names}]`);
        }

        conversation.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.tool_calls,
        });

        for (const tc of result.tool_calls) {
          const handler = executor[tc.function.name];
          let toolResult: string;
          if (handler) {
            try {
              const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              toolResult = await handler(args);
            } catch (err) {
              toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            toolResult = `Error: unknown tool "${tc.function.name}"`;
          }

          conversation.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
        continue;
      }

      // Model returned content without tool calls
      const content = result.content ?? "";
      if (debug) {
        console.log(
          `[copilot-chat] turn ${turn}: content (${content.length} chars):\n${content.slice(0, 500)}${content.length > 500 ? "\n…(truncated)" : ""}`
        );
      }

      // If no tool calls have been made yet, treat this as a preamble and nudge
      if (!toolCallsMade && turn < maxTurns - 1) {
        if (debug) {
          console.log(`[copilot-chat] turn ${turn}: no tool calls yet — nudging model to use tools`);
        }
        conversation.push({ role: "assistant", content });
        conversation.push({
          role: "user",
          content: "Please use the provided tools to investigate before responding. Call a tool now.",
        });
        continue;
      }

      return content;
    }

    // Exhausted turns — nudge the model to wrap up and respond
    if (debug) console.log(`[copilot-chat] turns exhausted — making final forced-content call`);
    conversation.push({
      role: "user",
      content: "Tool use limit reached. Please provide your final response now based on what you have gathered so far.",
    });
    const final = await this.requestRaw(conversation, {});
    if (debug) {
      const content = final.content ?? "";
      console.log(
        `[copilot-chat] final content (${content.length} chars):\n${content.slice(0, 500)}${content.length > 500 ? "\n…(truncated)" : ""}`
      );
    }
    return final.content ?? "";
  }

  // --- Private helpers ---

  private async request(
    messages: ChatMessage[],
    extra?: Record<string, unknown>
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Editor-Version": "vscode/1.95.0",
        "Copilot-Integration-Id": "vscode-chat",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.1,
        ...extra,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[copilot-chat] API error: ${response.status} ${response.statusText} — ${body}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices?.[0]?.message?.content ?? "";
  }

  private async requestRaw(
    messages: ToolUseMessage[],
    extra?: Record<string, unknown>
  ): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Editor-Version": "vscode/1.95.0",
        "Copilot-Integration-Id": "vscode-chat",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.1,
        ...extra,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `[copilot-chat] API error: ${response.status} ${response.statusText} — ${body}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
      }>;
    };

    const msg = data.choices?.[0]?.message;
    return {
      content: msg?.content ?? null,
      tool_calls: msg?.tool_calls,
    };
  }
}
