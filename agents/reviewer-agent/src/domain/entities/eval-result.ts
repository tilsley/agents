export type EvalAction = "approve" | "request_changes" | "none";

export interface EvalBreakdownItem {
  criterion: string;
  score: number; // 0-100
  reasoning: string;
}

export interface EvalResult {
  score: number; // 0-100
  summary: string;
  breakdown: EvalBreakdownItem[];
  action: EvalAction; // Set by policy, not LLM
}
