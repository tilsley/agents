import { CopilotClient } from "@github/copilot-sdk";
import type { ChatCompletionPort, ChatMessage } from "@tilsley/shared";

export class CopilotSdkChatAdapter implements ChatCompletionPort {
  private client: CopilotClient;

  constructor(
    private model = "claude-sonnet-4.6",
    cliUrl = "localhost:4321"
  ) {
    this.client = new CopilotClient({ cliUrl });
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const systemContent = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    const nonSystem = messages.filter((m) => m.role !== "system");

    const session = await this.client.createSession({
      model: this.model,
      ...(systemContent
        ? { systemMessage: { mode: "replace" as const, content: systemContent } }
        : {}),
    });

    try {
      const prompt = nonSystem
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");

      const response = await session.sendAndWait({ prompt });
      return response?.data.content ?? "";
    } finally {
      await session.destroy();
    }
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }
}
