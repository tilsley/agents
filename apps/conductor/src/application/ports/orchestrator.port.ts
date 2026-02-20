/**
 * OrchestratorPort abstracts the event bus / workflow engine.
 *
 * In production: implemented by InngestAdapter or BullMQ adapter.
 * In tests: implemented by InMemoryOrchestratorAdapter.
 *
 * See README.md for the full design rationale.
 */
export interface PipelineEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface OrchestratorPort {
  emit(event: PipelineEvent): Promise<void>;
  // Additional methods TBD: subscribe, schedule, etc.
}
