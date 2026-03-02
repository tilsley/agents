import type { ChatCompletionPort, ChatMessage } from "@tilsley/shared";

export class CopilotChatAdapter implements ChatCompletionPort {
  constructor(
    private token: string,
    private model = "claude-sonnet-4.6"
  ) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    const response = await fetch("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "Copilot-Integration-Id": "vscode-chat",
      },
      body: JSON.stringify({ model: this.model, messages }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Copilot API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message.content ?? "";
  }
}
