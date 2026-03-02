import type { Lesson } from "@tilsley/shared";
import type { PipelineSummary } from "../../domain/entities/pipeline-summary";

export interface SummarizerLlmPort {
  summarize(context: PipelineSummary, focus?: string): Promise<Lesson[]>;
}
