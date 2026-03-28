import type { DriftItem } from "./drift-report";
import type { PolicyRule } from "@tilsley/shared";

export interface FixItem {
  drift: DriftItem;
  action:
    | "rewrite-section"
    | "add-section"
    | "remove-claim"
    | "update-claim"
    | "create-file";
  file: string;
  section?: string;
  description: string;
  priority: number;
}

export interface DocUpdatePlan {
  repo: string;
  driftItems: DriftItem[];
  policyRules: PolicyRule[];
  fixes: FixItem[];
  giveUp: boolean;
  planReasoning: string;
}
