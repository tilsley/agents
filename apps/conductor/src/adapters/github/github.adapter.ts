import { Octokit } from "@octokit/rest";
import type { GitHubPort, PullRequest } from "@tilsley/shared";

export class GitHubAdapter implements GitHubPort {
  constructor(private octokit: Octokit) {}

  async getPullRequestForCheckRun(
    owner: string,
    repo: string,
    headSha: string
  ): Promise<PullRequest | null> {
    const { data: pulls } = await this.octokit.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    const pr = pulls.find((p) => p.head.sha === headSha);
    if (!pr) return null;

    return {
      owner,
      repo,
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user?.login ?? "",
    };
  }

  async getCheckRunAnnotations(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<string> {
    const { data: annotations } = await this.octokit.checks.listAnnotations({
      owner,
      repo,
      check_run_id: checkRunId,
      per_page: 50,
    });

    return annotations
      .map(
        (a) =>
          `${a.path}:${a.start_line} [${a.annotation_level}] ${a.message}`
      )
      .join("\n");
  }

  async getCheckRunLog(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<string> {
    try {
      return await this.getCheckRunAnnotations(owner, repo, checkRunId);
    } catch {
      return "";
    }
  }

  async rerunCheckRun(
    owner: string,
    repo: string,
    checkRunId: number
  ): Promise<void> {
    await this.octokit.checks.rerequestRun({
      owner,
      repo,
      check_run_id: checkRunId,
    });
  }

  async closePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    comment: string
  ): Promise<void> {
    await Promise.all([
      this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comment,
      }),
      this.octokit.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        state: "closed",
      }),
    ]);
  }

  async getCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string
  ): Promise<
    Array<{
      id: number;
      name: string;
      status: string;
      conclusion: string | null;
    }>
  > {
    const { data } = await this.octokit.checks.listForRef({
      owner,
      repo,
      ref,
      per_page: 100,
    });

    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion ?? null,
    }));
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<string> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    return data as unknown as string;
  }

  async commentOnPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  async approvePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: "APPROVE",
      body,
    });
  }

  async requestChangesOnPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: "REQUEST_CHANGES",
      body,
    });
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    await this.octokit.pulls.merge({
      owner,
      repo,
      pull_number: prNumber,
    });
  }

  async createPullRequest(
    owner: string,
    repo: string,
    options: { title: string; body: string; head: string; base: string }
  ): Promise<{ number: number; url: string }> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
    });
    return { number: data.number, url: data.html_url };
  }
}
