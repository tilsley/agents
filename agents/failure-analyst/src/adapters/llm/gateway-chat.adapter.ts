import { GatewayClient, machineTokenProvider, platformConfig } from "@agent-os/client";
import type { Message } from "@agent-os/client";
import type { ChatCompletionPort, ChatMessage } from "@tilsley/shared";

/** Try direct parse first; fall back to regex extraction if the model wrapped the JSON. */
function extractJson<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/[\[{][\s\S]*[\]}]/);
    if (!match) throw new SyntaxError("No JSON found in response");
    return JSON.parse(match[0]) as T;
  }
}

/**
 * ChatCompletionPort backed by the agent-os inference gateway (ADR-0040 Stage 1:
 * the external-agent mode). The agent authenticates as ITSELF — an M2M client
 * credential, not a person, not a model key — and every completion is verified,
 * tenant-attributed, and budget-metered platform-side. Swapping this in for the
 * Copilot adapter is the entire migration: the classifier composes unchanged.
 *
 * The platform wire has no system role (the loop owns system prompts there), so
 * system messages are folded into the first user turn — same tokens, same effect.
 */
export class GatewayChatAdapter implements ChatCompletionPort {
  private gateway: Promise<GatewayClient>;

  constructor(
    opts: { consoleUrl: string; gatewayUrl: string; clientId: string; clientSecret: string },
    private maxTokens = 2048
  ) {
    this.gateway = platformConfig(opts.consoleUrl).then(
      (cfg) =>
        new GatewayClient({
          gatewayUrl: opts.gatewayUrl,
          token: machineTokenProvider({
            hostedUiBaseUrl: cfg.hostedUiBaseUrl,
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
          }),
        })
    );
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const turn = await (await this.gateway).generate(toWire(messages), { maxTokens: this.maxTokens });
    return turn.text ?? "";
  }

  async completeJson<T = unknown>(messages: ChatMessage[]): Promise<T> {
    return extractJson<T>(await this.complete(messages));
  }
}

function toWire(messages: ChatMessage[]): Message[] {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system");
  const wire: Message[] = rest.map((m) =>
    m.role === "assistant" ? { role: "assistant", text: m.content } : { role: "user", text: m.content }
  );
  if (system.length) {
    const first = wire.findIndex((m) => m.role === "user");
    const prefix = system.join("\n\n");
    if (first >= 0 && wire[first].role === "user") {
      wire[first] = { role: "user", text: `${prefix}\n\n---\n\n${(wire[first] as { text: string }).text}` };
    } else {
      wire.unshift({ role: "user", text: prefix });
    }
  }
  return wire;
}
