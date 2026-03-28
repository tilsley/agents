import { Octokit } from "@octokit/rest";
import type { GitHubPort, GitHubIssueResult, PullRequest } from "@tilsley/shared";

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
      // Resolve the GitHub Actions job ID from the check run's details_url.
      // Format: https://github.com/{owner}/{repo}/actions/runs/{run_id}/job/{job_id}
      // Non-Actions check runs (CircleCI, Jenkins, etc.) won't match — return "" for those.
      const { data: checkRun } = await this.octokit.checks.get({
        owner,
        repo,
        check_run_id: checkRunId,
      });

      const jobIdMatch = checkRun.details_url?.match(/\/job\/(\d+)/);
      if (!jobIdMatch) return "";

      const jobId = parseInt(jobIdMatch[1], 10);

      // Find the failed step name so we can isolate its log section.
      const { data: job } = await this.octokit.actions.getJobForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
      });
      const failedStep = job.steps?.find((s) => s.conclusion === "failure");

      // Download plain-text job log (GitHub redirects to a temporary URL).
      const response = await this.octokit.request(
        "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs",
        { owner, repo, job_id: jobId }
      );

      const fullLog =
        typeof response.data === "string"
          ? response.data
          : Buffer.isBuffer(response.data)
            ? response.data.toString("utf-8")
            : null;

      if (!fullLog) return "";
      if (!failedStep) return fullLog;

      // Parse out the ##[group]{failedStepName}...##[endgroup] block.
      // Lines carry a timestamp prefix in the raw log; strip it temporarily for matching.
      const timestampPrefix = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/;
      const lines = fullLog.split("\n");
      const stripped = lines.map((l) => l.replace(timestampPrefix, ""));

      const groupHeader = `##[group]${failedStep.name}`;
      const startIdx = stripped.findIndex((l) => l === groupHeader);
      if (startIdx === -1) return fullLog;

      const endIdx = stripped.findIndex(
        (l, i) => i > startIdx && l === "##[endgroup]"
      );
      const sliceEnd = endIdx === -1 ? lines.length : endIdx + 1;

      return lines.slice(startIdx, sliceEnd).join("\n");
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

  async searchIssues(
    owner: string,
    repo: string,
    query: string
  ): Promise<GitHubIssueResult[]> {
    try {
      const { data } = await this.octokit.search.issuesAndPullRequests({
        q: `repo:${owner}/${repo} ${query} is:issue`,
        per_page: 10,
        sort: "created",
        order: "desc",
      });

      return data.items.map((item) => ({
        title: item.title,
        url: item.html_url,
        body: item.body ?? "",
        state: item.state,
        labels: item.labels.map((l) =>
          typeof l === "string" ? l : l.name ?? ""
        ),
        createdAt: item.created_at,
      }));
    } catch {
      return [];
    }
  }

  async getReleaseNotes(
    owner: string,
    repo: string,
    fromVersion: string,
    toVersion: string
  ): Promise<string> {
    try {
      const releases = await this.octokit.paginate(
        this.octokit.repos.listReleases,
        { owner, repo, per_page: 100 }
      );

      const from = parseSemver(fromVersion);
      const to = parseSemver(toVersion);
      if (!from || !to) return "";

      const relevant = releases.filter((r) => {
        const v = parseSemver(r.tag_name);
        return v && semverGt(v, from) && !semverGt(v, to);
      });

      if (relevant.length === 0) return "";

      const body = relevant
        .map((r) => `## ${r.name ?? r.tag_name}\n\n${r.body ?? ""}`.trim())
        .join("\n\n---\n\n");

      return body.slice(0, 8_000);
    } catch {
      return "";
    }
  }
}

type Semver = [number, number, number];

function parseSemver(v: string): Semver | null {
  const clean = v.replace(/^[v^~]/, "");
  const parts = clean.split(".").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

function semverGt(a: Semver, b: Semver): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}
