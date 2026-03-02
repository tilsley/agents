import type { AgentType } from "../entities/agent-assignment";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const AGENT_TIMEOUTS: Record<AgentType, number> = {
  "failure-analyst": 2 * 60 * 1000,  // 2 minutes
  "review-agent": 5 * 60 * 1000,     // 5 minutes
  "distiller": 3 * 60 * 1000,        // 3 minutes
};

export function getTimeoutForAgent(agentType: AgentType): number {
  return AGENT_TIMEOUTS[agentType] ?? DEFAULT_TIMEOUT_MS;
}

export function isTimedOut(assignedAt: Date, agentType: AgentType, now: Date = new Date()): boolean {
  const timeout = getTimeoutForAgent(agentType);
  return now.getTime() - assignedAt.getTime() > timeout;
}
