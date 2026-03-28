import type { DocClaim } from "../../domain/entities/doc-claim";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { DriftItem } from "../../domain/entities/drift-report";
import type { DocUpdatePlan } from "../../domain/entities/doc-update-plan";
import type { PolicyRule } from "@tilsley/shared";

export interface DocPlannerLlmPort {
  analyzeGapsAndPlan(input: {
    claims: DocClaim[];
    codeSnapshot: CodeSnapshot;
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string;
    repo: string;
  }): Promise<DocUpdatePlan>;
}
