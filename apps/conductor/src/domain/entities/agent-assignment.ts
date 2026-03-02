export type AgentType = "context-store" | "failure-analyst" | "review-agent" | "distiller";

export interface AgentAssignment {
  taskId: string;
  agentType: AgentType;
  correlationId: string;
  assignedAt: Date;
  completedAt?: Date;
}
