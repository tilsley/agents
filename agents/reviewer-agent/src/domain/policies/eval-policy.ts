import { isBotPr } from "./review-policy";
import type { EvalAction } from "../entities/eval-result";

export interface EvalThresholds {
  approveAbove: number;
  requestChangesBelow: number;
}

export function isSuccessfulCheck(conclusion: string | null): boolean {
  return conclusion === "success";
}

export function isAllChecksPassed(
  checks: Array<{ status: string; conclusion: string | null }>
): boolean {
  if (checks.length === 0) return false;
  return checks.every(
    (c) => c.status === "completed" && c.conclusion === "success"
  );
}

export function shouldRunEval(
  author: string,
  botUsername: string,
  conclusion: string | null
): boolean {
  return isBotPr(author, botUsername) && isSuccessfulCheck(conclusion);
}

export function determineEvalAction(
  score: number,
  thresholds: EvalThresholds
): EvalAction {
  if (score >= thresholds.approveAbove) return "approve";
  if (score <= thresholds.requestChangesBelow) return "request_changes";
  return "none";
}
