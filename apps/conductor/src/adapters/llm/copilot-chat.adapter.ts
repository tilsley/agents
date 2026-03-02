import type { ChatCompletionPort, ChatMessage } from "@tilsley/shared";

export class CopilotChatAdapter implements ChatCompletionPort {
  constructor(
    private token: string,
    private model = "claude-sonnet-4.6",
    private endpoint = "https://api.githubcopilot.com/chat/completions"
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Editor-Version": "vscode/1.95.0",
        "Copilot-Integration-Id": "vscode-chat",
      },
      body: JSON.stringify({ model: this.model, messages, temperature: 0.1 }),
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
}
