import type { PipelineEvent } from "@tilsley/shared";

export type EventHandler = (event: PipelineEvent) => Promise<void>;

export interface OrchestratorPort {
  emit(event: PipelineEvent): Promise<void>;
  on(type: string, handler: EventHandler): void;
  off(type: string, handler: EventHandler): void;
}
