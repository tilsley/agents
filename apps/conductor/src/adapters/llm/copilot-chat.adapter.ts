import type { ChatCompletionPort, ChatMessage } from "@tilsley/shared";

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

export class CopilotChatAdapter implements ChatCompletionPort {
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
}
