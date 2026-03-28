import type { PullRequest } from "../../domain/entities/pull-request";

export interface GitHubIssueResult {
  title: string;
  url: string;
  body: string;
  state: string;
  labels: string[];
  createdAt: string;
}

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
  ): Promise<
    Array<{ id: number; name: string; status: string; conclusion: string | null }>
  >;

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

  mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<void>;

  createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string;
      body: string;
      head: string;
      base: string;
    }
  ): Promise<{ number: number; url: string }>;

  /**
   * Fetches release notes for a GitHub repo between two semver tags (exclusive
   * of fromVersion, inclusive of toVersion). Returns an empty string if the
   * repo has no releases in that range or if the API call fails.
   */
  getReleaseNotes(
    owner: string,
    repo: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string>;

  searchIssues(
    owner: string,
    repo: string,
    query: string
  ): Promise<GitHubIssueResult[]>;
}
