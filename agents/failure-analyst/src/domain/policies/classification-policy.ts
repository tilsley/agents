import type { FailureCategory } from "@tilsley/shared";

export interface HeuristicMatch {
  category: FailureCategory;
  errorType: string;
  errorPattern: string;
  confidence: number;
}

// Only patterns that are unambiguously infra — passed to the LLM as a hint,
// not used to bypass it. "timeout" deliberately omitted: a test timing out
// because of a performance regression looks identical to an infra flake.
const FLAKE_PATTERNS: Array<{ regex: RegExp; errorType: string }> = [
  { regex: /ETIMEDOUT|ECONNRESET|ECONNREFUSED/i, errorType: "network_error" },
  { regex: /rate.?limit/i,                        errorType: "rate_limit" },
  { regex: /socket hang up/i,                     errorType: "socket_hangup" },
  { regex: /ENOMEM/i,                             errorType: "oom" },
];

export function classifyByHeuristic(
  checkName: string,
  output: string
): HeuristicMatch | null {
  for (const pattern of FLAKE_PATTERNS) {
    const match = output.match(pattern.regex);
    if (match) {
      return {
        category: "infra_flake",
        errorType: pattern.errorType,
        errorPattern: match[0],
        confidence: 0.85,
      };
    }
  }

  return null;
}

export const LLM_CONFIDENCE_THRESHOLD = 0.6;

export function shouldTrustLlmClassification(confidence: number): boolean {
  return confidence >= LLM_CONFIDENCE_THRESHOLD;
}

export type DecisionInput = {
  category: FailureCategory;
  retryCount: number;
  maxRetries: number;
};

export function mapCategoryToDecision(
  input: DecisionInput
): "retry" | "route_to_fixer" | "escalate" | "skip" {
  switch (input.category) {
    case "infra_flake":
      return input.retryCount >= input.maxRetries ? "escalate" : "retry";
    case "code_bug":
      return "route_to_fixer";
    case "unknown":
      return "skip";
  }
}
