import type { FailureSignature } from "@tilsley/shared";

export type FailureDecision =
  | "retry"
  | "route_to_fixer"
  | "escalate"
  | "skip";

export interface FailureAnalysis {
  checkRunId: number;
  checkName: string;
  category: FailureSignature["category"];
  decision: FailureDecision;
  signature: FailureSignature;
  reasoning: string;
}
