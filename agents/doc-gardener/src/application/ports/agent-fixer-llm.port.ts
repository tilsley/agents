import type { RepoInventory } from "../../domain/policies/drift-detection-policy";
import type { DriftItem } from "../../domain/entities/drift-report";
import type { PolicyRule, RepoTemplate } from "@tilsley/shared";

export interface AgentFixerLlmPort {
  fix(input: {
    workDir: string;
    inventory: RepoInventory;
    docFiles: Array<{ path: string; content: string }>;
    policyRules: PolicyRule[];
    repo: string;
    template?: RepoTemplate;
  }): Promise<{
    driftItems: DriftItem[];
    planReasoning: string;
  }>;
}
