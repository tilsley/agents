import type { Lesson } from "@tilsley/shared";
import type { PatchPlan } from "../../domain/entities/patch-plan";

export interface PatchAdvice {
  warnings: string[];
  migrationNotes: string[];
  scopingRecommendation: string | null;
  riskLevel: "low" | "medium" | "high";
  /**
   * Package names (from the fix plan) the advisor wants removed from this PR.
   * Each entry must match a packageName in the plan exactly.
   * The use-case will move these to plan.skipped before applying any git changes.
   */
  packagesToDefer: string[];
}

export interface PatchAdvisorLlmPort {
  advise(plan: PatchPlan, lessons: Lesson[]): Promise<PatchAdvice>;
}
