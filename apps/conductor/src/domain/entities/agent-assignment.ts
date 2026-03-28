export type AgentType = "context-store" | "failure-analyst" | "review-agent" | "distiller" | "feedback-classifier";

export interface AgentAssignment {
  taskId: string;
  agentType: AgentType;
  correlationId: string;
  assignedAt: Date;
  completedAt?: Date;
}
