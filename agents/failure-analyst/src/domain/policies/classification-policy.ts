import type { FailureCategory } from "@tilsley/shared";

export interface HeuristicMatch {
  category: FailureCategory;
  errorType: string;
  errorPattern: string;
  confidence: number;
}

const FLAKE_PATTERNS: Array<{ regex: RegExp; errorType: string }> = [
  { regex: /ETIMEDOUT|ECONNRESET|ECONNREFUSED/i, errorType: "network_error" },
  { regex: /rate limit/i, errorType: "rate_limit" },
  { regex: /timeout|timed?\s*out/i, errorType: "timeout" },
  { regex: /socket hang up/i, errorType: "socket_hangup" },
  { regex: /ENOMEM|out of memory/i, errorType: "oom" },
  { regex: /Resource temporarily unavailable/i, errorType: "resource_unavailable" },
  { regex: /flaky|non-deterministic|intermittent/i, errorType: "known_flaky" },
];

const BUG_PATTERNS: Array<{ regex: RegExp; errorType: string }> = [
  { regex: /SyntaxError|TypeError|ReferenceError/i, errorType: "js_error" },
  { regex: /compilation error|compile error/i, errorType: "compilation_error" },
  { regex: /cannot find module|missing import/i, errorType: "import_error" },
  { regex: /type '.*' is not assignable/i, errorType: "type_error" },
  { regex: /expected .* but received/i, errorType: "assertion_failure" },
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
        confidence: 0.8,
      };
    }
  }

  for (const pattern of BUG_PATTERNS) {
    const match = output.match(pattern.regex);
    if (match) {
      return {
        category: "code_bug",
        errorType: pattern.errorType,
        errorPattern: match[0],
        confidence: 0.7,
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
