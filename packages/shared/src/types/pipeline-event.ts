export interface PipelineEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  correlationId: string;
}
