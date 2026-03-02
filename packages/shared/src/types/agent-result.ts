export type AgentResultStatus = "success" | "failure" | "skipped";

export interface AgentResult {
  taskId: string;
  status: AgentResultStatus;
  output: Record<string, unknown>;
}
