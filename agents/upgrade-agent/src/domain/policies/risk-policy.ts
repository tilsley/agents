import type { RiskLevel } from "../entities/upgrade-plan";

/**
 * Deterministic risk estimate based purely on the version delta.
 * Used as an initial signal — the research LLM may adjust it up or down
 * based on changelogs and known issues.
 *
 * | Condition                    | Risk     |
 * |------------------------------|----------|
 * | Major version bump           | critical |
 * | 50+ minor versions           | critical |
 * | 11–49 minor versions         | high     |
 * | 5–10 minor versions          | medium   |
 * | 1–4 minor / any patch        | low      |
 */
export function deriveRiskLevel(fromVersion: string, toVersion: string): RiskLevel {
  const from = parseVersion(fromVersion);
  const to = parseVersion(toVersion);

  if (!from || !to) return "high"; // unparseable — assume risky

  if (to.major > from.major) return "critical";
  if (to.major < from.major) return "critical"; // downgrade

  const minorSpan = to.minor - from.minor;
  if (minorSpan < 0) return "high"; // minor downgrade
  if (minorSpan >= 50) return "critical";
  if (minorSpan >= 11) return "high";
  if (minorSpan >= 5) return "medium";
  return "low";
}

/** True if the heuristic risk alone warrants blocking without research. */
export function isRiskTooHighToAttempt(risk: RiskLevel): boolean {
  // We always proceed to research — even critical gets researched.
  // The research LLM makes the final proceed/block decision.
  // This hook exists for future policy changes (e.g. block on critical without a flag).
  return false;
}

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const clean = v.replace(/^[^0-9]*/, ""); // strip leading ^ ~ v etc.
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
