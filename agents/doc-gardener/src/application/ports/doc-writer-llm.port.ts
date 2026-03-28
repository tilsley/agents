import type { FixItem } from "../../domain/entities/doc-update-plan";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { PolicyRule } from "@tilsley/shared";

export interface DocWriterLlmPort {
  applyFix(input: {
    fix: FixItem;
    currentContent: string | null;
    codeSnapshot: CodeSnapshot;
    policyRules: PolicyRule[];
  }): Promise<{ file: string; content: string; changeDescription: string }>;
}
