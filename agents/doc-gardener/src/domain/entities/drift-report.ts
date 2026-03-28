export type DriftType =
  | "undocumented-script"
  | "undocumented-env-var"
  | "stale-reference"
  | "undocumented-config"
  | "missing-readme"
  | "missing-section"
  | "semantic-drift";

export type DriftSeverity = "high" | "medium" | "low";

export interface DriftItem {
  file: string;
  section?: string;
  driftType: DriftType;
  severity: DriftSeverity;
  detail: string;
  source: "deterministic" | "llm";
  claim?: string;
  codeEvidence?: string;
  confidence?: number;
  reasoning?: string;
}
