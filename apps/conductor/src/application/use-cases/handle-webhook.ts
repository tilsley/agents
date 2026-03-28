import type { PipelineEvent, CheckRun } from "@tilsley/shared";
import type { OrchestratorPort } from "@tilsley/shared";

export interface WebhookPayload {
  action: string;
  eventType: string;
  checkRun?: {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    headSha: string;
    output: {
      title: string | null;
      summary: string | null;
      text: string | null;
    };
  };
  pullRequest?: {
    number: number;
    headSha: string;
    prAuthor: string;
    prTitle: string;
  };
  issueComment?: {
    commentId: number;
    commentBody: string;
    commentAuthor: string;
    issueNumber: number;
    isPullRequest: boolean;
    issueBody: string;
    issueAuthor: string;
  };
  repository: {
    owner: string;
    name: string;
  };
}

export class HandleWebhook {
  constructor(private orchestrator: OrchestratorPort) {}

  async execute(payload: WebhookPayload): Promise<PipelineEvent | null> {
    if (payload.eventType === "pull_request") {
      return this.handlePullRequest(payload);
    }

    if (payload.eventType === "check_run") {
      return this.handleCheckRun(payload);
    }

    if (payload.eventType === "issue_comment") {
      return this.handleIssueComment(payload);
    }

    return null;
  }

  private async handlePullRequest(payload: WebhookPayload): Promise<PipelineEvent | null> {
    if (payload.action !== "opened" && payload.action !== "synchronize") {
      return null;
    }

    if (!payload.pullRequest) {
      return null;
    }

    const { owner, name: repo } = payload.repository;
    const { number: prNumber, headSha, prAuthor, prTitle } = payload.pullRequest;

    // correlationId matches check_run events (keyed by headSha) so the
    // context stored here can be found when check_run.passed arrives.
    const event: PipelineEvent = {
      type: "pull_request.opened",
      payload: { owner, repo, prNumber, headSha, prAuthor, prTitle },
      timestamp: new Date(),
      correlationId: `${owner}/${repo}:${headSha}`,
    };

    await this.orchestrator.emit(event);
    return event;
  }

  private async handleCheckRun(payload: WebhookPayload): Promise<PipelineEvent | null> {
    if (payload.action !== "completed") {
      return null;
    }

    if (!payload.checkRun) {
      return null;
    }

    const { owner, name: repo } = payload.repository;
    const cr = payload.checkRun;

    const checkRun: CheckRun = {
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
      headSha: cr.headSha,
      output: {
        title: cr.output.title,
        summary: cr.output.summary,
        text: cr.output.text,
      },
    };

    // Route to different pipeline branches based on CI outcome.
    // success/neutral/skipped → straight to review-agent
    // failure/timed_out/cancelled/action_required → failure-analyst first
    const passed = ["success", "neutral", "skipped"].includes(cr.conclusion ?? "");
    const eventType = passed ? "check_run.passed" : "check_run.failed";

    const event: PipelineEvent = {
      type: eventType,
      payload: { owner, repo, checkRun, headSha: cr.headSha },
      timestamp: new Date(),
      correlationId: `${owner}/${repo}:${cr.headSha}`,
    };

    await this.orchestrator.emit(event);
    return event;
  }

  private async handleIssueComment(payload: WebhookPayload): Promise<PipelineEvent | null> {
    if (payload.action !== "created") {
      return null;
    }

    if (!payload.issueComment) {
      return null;
    }

    // Only process comments on PRs (not regular issues)
    if (!payload.issueComment.isPullRequest) {
      return null;
    }

    // Filter: only process comments on PRs authored by bot accounts
    const botAuthors = ["doc-gardener-bot", "chore-bot", "tilsley-bot"];
    if (!botAuthors.includes(payload.issueComment.issueAuthor)) {
      return null;
    }

    const { owner, name: repo } = payload.repository;
    const { commentBody, commentAuthor, issueNumber, issueBody } = payload.issueComment;

    const event: PipelineEvent = {
      type: "issue_comment.created",
      payload: {
        owner,
        repo,
        prNumber: issueNumber,
        commentBody,
        commentAuthor,
        prBody: issueBody,
      },
      timestamp: new Date(),
      correlationId: `${owner}/${repo}:comment-${payload.issueComment.commentId}`,
    };

    await this.orchestrator.emit(event);
    return event;
  }
}
