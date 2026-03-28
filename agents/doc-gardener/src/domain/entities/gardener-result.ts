import type { DriftItem } from "./drift-report";
import type { DocUpdatePlan } from "./doc-update-plan";

export type GardenerStatus =
  | "clean"
  | "pr-opened"
  | "loop-exhausted"
  | "gave-up"
  | "error";

export interface GardenerResult {
  status: GardenerStatus;
  driftItems: DriftItem[];
  plan?: DocUpdatePlan;
  iterationsUsed: number;
  remainingGaps: number;
  prUrl?: string;
  error?: string;
}
