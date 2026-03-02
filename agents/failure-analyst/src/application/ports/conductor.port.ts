import type { PipelineEvent } from "@tilsley/shared";

export interface ConductorPort {
  emit(event: PipelineEvent): Promise<void>;
}
