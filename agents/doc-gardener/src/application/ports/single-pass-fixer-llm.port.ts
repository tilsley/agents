import type { SourceFile } from "./code-analyzer-llm.port";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";
import type { DriftItem } from "../../domain/entities/drift-report";
import type { PolicyRule } from "@tilsley/shared";

export interface SinglePassFixerLlmPort {
  fix(input: {
    inventory: RepoInventory;
    sourceFiles: SourceFile[];
    deterministicDrift: DriftItem[];
    policyRules: PolicyRule[];
    currentDoc: string | null;
    repo: string;
  }): Promise<{
    driftItems: DriftItem[];
    files: Array<{ file: string; content: string }>;
    planReasoning: string;
  }>;
}
