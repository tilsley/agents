export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionPort {
  complete(messages: ChatMessage[]): Promise<string>;
}
