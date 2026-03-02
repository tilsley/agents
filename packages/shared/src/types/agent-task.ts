export interface AgentTask {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
}
