import type { ChatCompletionPort } from "@tilsley/shared";
import type { DiscoveryLlmPort, UpgradeCandidate } from "../../application/ports/discovery-llm.port";

const SYSTEM_PROMPT = `You are a dependency management expert. Given a list of outdated npm packages with their current versions, latest versions, and risk levels, select the single best package to upgrade.

Prefer packages that:
- Have a lower risk level (low > medium > high > critical)
- Are significantly outdated
- Are commonly used and well-maintained core dependencies (not dev tooling)

Respond ONLY with valid JSON:
{"packageName": "express"}

Or if none are suitable:
{"packageName": null}`;

export class CopilotDiscoveryAdapter implements DiscoveryLlmPort {
  constructor(private chatCompletion: ChatCompletionPort) {}

  async selectTarget(candidates: UpgradeCandidate[]): Promise<UpgradeCandidate | null> {
    const table = candidates
      .map((c) => `- ${c.packageName}: ${c.currentVersion} → ${c.latestVersion} (${c.riskLevel})`)
      .join("\n");

    try {
      const parsed = await this.chatCompletion.completeJson<{ packageName?: string | null }>([
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Outdated packages:\n${table}` },
      ]);

      if (!parsed.packageName) return null;
      return candidates.find((c) => c.packageName === parsed.packageName) ?? null;
    } catch (err) {
      console.error("[copilot-discovery] Failed to get/parse LLM response:", err);
      return null;
    }
  }
}
