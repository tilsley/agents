import type { PullRequest } from "../../domain/entities/pull-request";

export interface GitHubPort {
  getPullRequestForCheckRun(
    owner: string,
    repo: string,
    headSha: string
  ): Promise<PullRequest | null>;

  getCheckRunAnnotations(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<string>;

  getCheckRunLog(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<string>;

  rerunCheckRun(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<void>;

  closePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    comment: string
  ): Promise<void>;

  getCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string
  ): Promise<Array<{ id: number; name: string; status: string; conclusion: string | null }>>;

  getPullRequestDiff(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<string>;

  commentOnPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void>;

  approvePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void>;

  requestChangesOnPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void>;
}
