import type { PipelineEvent, AgentResult } from "@tilsley/shared";
import type { OrchestratorPort } from "../ports/orchestrator.port";
import { getNextStageEvent, isTerminalEvent } from "../../domain/policies/routing-policy";

export class HandleAgentCompletion {
  constructor(private orchestrator: OrchestratorPort) {}

  async execute(
    completedEventType: string,
    result: AgentResult,
    correlationId: string
  ): Promise<PipelineEvent | null> {
    if (result.status === "failure") {
      const failedEvent: PipelineEvent = {
        type: "pipeline.failed",
        payload: {
          failedAt: completedEventType,
          taskId: result.taskId,
          output: result.output,
        },
        timestamp: new Date(),
        correlationId,
      };

      console.log(
        `[conductor:completion] Agent failed at ${completedEventType} (task: ${result.taskId})`
      );

      await this.orchestrator.emit(failedEvent);
      return failedEvent;
    }

    if (isTerminalEvent(completedEventType)) {
      console.log(
        `[conductor:completion] Pipeline complete (${correlationId})`
      );
      return null;
    }

    const nextEventType = getNextStageEvent(completedEventType);
    if (!nextEventType) {
      console.log(
        `[conductor:completion] No next stage for ${completedEventType}`
      );
      return null;
    }

    // Map from completion event types to their result event types
    const resultEventType = this.mapToResultEvent(completedEventType);

    const nextEvent: PipelineEvent = {
      type: resultEventType,
      payload: {
        ...result.output,
        taskId: result.taskId,
      },
      timestamp: new Date(),
      correlationId,
    };

    console.log(
      `[conductor:completion] ${completedEventType} → emitting ${resultEventType}`
    );

    await this.orchestrator.emit(nextEvent);
    return nextEvent;
  }

  private mapToResultEvent(completedEventType: string): string {
    const RESULT_EVENTS: Record<string, string> = {
      "check_run.failed": "failure-analysis.completed",
      "failure-analysis.completed": "review.completed",
      "review.completed": "distillation.completed",
    };
    return RESULT_EVENTS[completedEventType] ?? `${completedEventType}.result`;
  }
}
