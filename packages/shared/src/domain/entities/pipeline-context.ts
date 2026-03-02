import type { PullRequest } from "./pull-request";
import type { CheckRun } from "./check-run";
import type { FailureSignature } from "./failure-signature";
import type { Lesson } from "./lesson";

export interface PipelineContext {
  pullRequest: PullRequest;
  headSha: string;
  checkRuns: CheckRun[];
  failureSignatures: FailureSignature[];
  diff: string;
  lessons: Lesson[];
  metadata: Record<string, unknown>;
}
