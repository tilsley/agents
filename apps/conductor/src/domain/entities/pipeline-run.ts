export type PipelineStage =
  | "pending"
  | "failure_analysis"
  | "review"
  | "distillation"
  | "completed"
  | "failed";

export interface PipelineStageEntry {
  stage: PipelineStage;
  enteredAt: Date;
  completedAt?: Date;
}

export interface PipelineRun {
  id: string;
  correlationId: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  currentStage: PipelineStage;
  history: PipelineStageEntry[];
  createdAt: Date;
}
