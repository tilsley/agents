export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionPort {
  complete(messages: ChatMessage[]): Promise<string>;
  completeJson<T = unknown>(messages: ChatMessage[]): Promise<T>;
}

// --- Tool-use extensions ---

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantToolCallMessage {
  role: "assistant";
  content: string | null;
  tool_calls: ToolCall[];
}

export interface ToolResultMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type ToolUseMessage = ChatMessage | AssistantToolCallMessage | ToolResultMessage;
export type ToolExecutor = Record<string, (args: Record<string, unknown>) => Promise<string>>;

export interface CompleteWithToolsOptions {
  maxTurns?: number;
}

export interface ToolUseChatCompletionPort extends ChatCompletionPort {
  completeWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    executor: ToolExecutor,
    options?: CompleteWithToolsOptions
  ): Promise<string>;
}

// --- Agent session (SDK built-in tools) ---

export interface AgentSessionConfig {
  systemPrompt: string;
  userPrompt: string;
  workingDirectory: string;
  availableTools?: string[];
  timeout?: number;
}

export interface AgentSessionPort {
  runAgentSession(config: AgentSessionConfig): Promise<string>;
}
