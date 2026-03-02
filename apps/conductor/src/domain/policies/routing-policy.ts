import type { AgentType } from "../entities/agent-assignment";

const EVENT_TO_AGENT: Record<string, AgentType> = {
  // Store PR context so it's available when check_run fires later
  "pull_request.opened": "context-store",
  // CI passed — go straight to review
  "check_run.passed": "review-agent",
  // CI failed — diagnose first, then review
  "check_run.failed": "failure-analyst",
  "failure-analysis.completed": "review-agent",
  "review.completed": "distiller",
};

export function getAgentForEvent(eventType: string): AgentType | null {
  return EVENT_TO_AGENT[eventType] ?? null;
}

export function getNextStageEvent(eventType: string): string | null {
  const STAGE_MAP: Record<string, string> = {
    "check_run.failed": "failure-analysis.completed",
    "failure-analysis.completed": "review.completed",
    "review.completed": "distillation.completed",
  };
  return STAGE_MAP[eventType] ?? null;
}

export function isTerminalEvent(eventType: string): boolean {
  return eventType === "distillation.completed" || eventType === "pipeline.failed";
}

export function getSupportedEventTypes(): string[] {
  return Object.keys(EVENT_TO_AGENT);
}
