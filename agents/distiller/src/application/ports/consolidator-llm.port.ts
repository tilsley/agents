import type { Lesson } from "@tilsley/shared";

export interface ConsolidationResult {
  repo: Lesson[];
  global: Lesson[];
}

export interface ConsolidatorLlmPort {
  consolidate(
    existing: { repo: Lesson[]; global: Lesson[] },
    incoming: Lesson[]
  ): Promise<ConsolidationResult>;
}
