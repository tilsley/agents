import type { PullRequest, ReviewChecklist, Lesson } from "@tilsley/shared";

export interface ReviewContext {
  pullRequest: PullRequest;
  diff: string;
  checklist: ReviewChecklist;
  relevantLessons: Lesson[];
  pastReviews: string[];
}
