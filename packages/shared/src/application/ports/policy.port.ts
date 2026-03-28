import type { PolicyRule } from "../../domain/entities/policy-rule";

export interface PolicyPort {
  listRules(opts?: {
    type?: string;
    scope?: string;
    repo?: string;
    active?: boolean;
  }): Promise<PolicyRule[]>;

  addRule(
    rule: Omit<PolicyRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PolicyRule>;

  updateRule(
    id: string,
    updates: Partial<Pick<PolicyRule, "active" | "rule" | "confidence">>
  ): Promise<PolicyRule | null>;
}
