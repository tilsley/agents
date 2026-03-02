import type { ReviewChecklist, Lesson, FailureSignature } from "@tilsley/shared";
import type { ChecklistScore } from "../../domain/entities/review-result";

export interface ReviewerLlmContext {
  prTitle: string;
  prBody: string;
  diff: string;
  checklist: ReviewChecklist;
  relevantLessons: Lesson[];
  failureSignatures?: FailureSignature[];
}

export interface ReviewerLlmPort {
  evaluateChecklist(context: ReviewerLlmContext): Promise<ChecklistScore[]>;
}
