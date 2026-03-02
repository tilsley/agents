import type { Lesson } from "@tilsley/shared";

export interface DistillationResult {
  lessons: Lesson[];
  storedCount: number;
  filteredCount: number;
}
