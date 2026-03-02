import type { PipelineEvent, AgentTask } from "@tilsley/shared";
import type { OrchestratorPort } from "../ports/orchestrator.port";
import { getAgentForEvent, getSupportedEventTypes } from "../../domain/policies/routing-policy";
import type { AgentType } from "../../domain/entities/agent-assignment";

export type AgentDispatcher = (agentType: AgentType, task: AgentTask) => Promise<void>;

export class RouteEvent {
  private taskCounter = 0;

  constructor(
    private orchestrator: OrchestratorPort,
    private dispatch: AgentDispatcher
  ) {}

  start(): void {
    for (const eventType of getSupportedEventTypes()) {
      this.orchestrator.on(eventType, (event) => this.handleEvent(event));
    }
  }

  stop(): void {
    for (const eventType of getSupportedEventTypes()) {
      this.orchestrator.off(eventType, (event) => this.handleEvent(event));
    }
  }

  private async handleEvent(event: PipelineEvent): Promise<void> {
    const agentType = getAgentForEvent(event.type);
    if (!agentType) {
      console.log(`[conductor:route] No agent for event type: ${event.type}`);
      return;
    }

    const task: AgentTask = {
      taskId: `task-${++this.taskCounter}`,
      type: event.type,
      payload: {
        ...event.payload,
        correlationId: event.correlationId,
      },
    };

    console.log(
      `[conductor:route] Dispatching ${event.type} → ${agentType} (task: ${task.taskId})`
    );

    await this.dispatch(agentType, task);
  }
}
