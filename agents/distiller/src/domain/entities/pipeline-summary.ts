import type { PullRequest, FailureSignature } from "@tilsley/shared";

export interface PipelineSummary {
  pullRequest: PullRequest;
  headSha: string;
  failureSignatures: FailureSignature[];
  reviewScore: number;
  reviewDecision: string;
  reviewFeedback: string;
  diff: string;
  metadata: Record<string, unknown>;
}
