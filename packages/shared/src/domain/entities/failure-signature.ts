export type FailureCategory = "code_bug" | "infra_flake" | "unknown";

export interface FailureSignature {
  checkName: string;
  errorType: string;
  errorPattern: string;
  category: FailureCategory;
  confidence: number;
}
