import type { CheckRunEvent } from "./handle-check-run-completed";
import type { GitHubPort } from "../ports/github.port";
import type { LlmPort } from "../ports/llm.port";
import { isBotPr } from "../../domain/policies/review-policy";
import { isAllChecksPassed } from "../../domain/policies/eval-policy";
import { determineEvalAction } from "../../domain/policies/eval-policy";
import type { EvalThresholds } from "../../domain/policies/eval-policy";
import type { EvalResult } from "../../domain/entities/eval-result";
import { formatEvalComment } from "../../domain/utils/format-eval-comment";
import { truncateLog } from "../../domain/utils/truncate-log";

export interface HandlePrEvalConfig {
  botUsername: string;
  evalPrompt: string;
  thresholds: EvalThresholds;
  diffMaxLength?: number;
}

const DEFAULT_DIFF_MAX_LENGTH = 10000;

export class HandlePrEval {
  private config: Required<HandlePrEvalConfig>;

  constructor(
    private github: GitHubPort,
    private llm: LlmPort,
    config: HandlePrEvalConfig
  ) {
    this.config = {
      ...config,
      diffMaxLength: config.diffMaxLength ?? DEFAULT_DIFF_MAX_LENGTH,
    };
  }

  async execute(event: CheckRunEvent): Promise<void> {
    return this.executeBatch([event]);
  }

  async executeBatch(events: CheckRunEvent[]): Promise<void> {
    if (events.length === 0) return;

    const { owner, repo } = events[0];
    const headSha = events[0].checkRun.headSha;

    // Look up PR
    const pr = await this.github.getPullRequestForCheckRun(
      owner,
      repo,
      headSha
    );

    if (!pr) {
      console.log(`[eval:skip] No PR found for check runs (sha: ${headSha})`);
      return;
    }

    // Verify bot authorship
    if (!isBotPr(pr.author, this.config.botUsername)) {
      console.log(
        `[eval:skip] PR #${pr.number} by ${pr.author} — not a bot PR`
      );
      return;
    }

    // Verify all checks passed
    const checks = await this.github.getCheckRunsForRef(owner, repo, headSha);
    if (!isAllChecksPassed(checks)) {
      console.log(
        `[eval:skip] PR #${pr.number} — not all checks passed`
      );
      return;
    }

    // Fetch diff
    const rawDiff = await this.github.getPullRequestDiff(
      owner,
      repo,
      pr.number
    );
    const diff = truncateLog(rawDiff, {
      maxLength: this.config.diffMaxLength,
    });

    // LLM evaluation
    const evalResponse = await this.llm.evaluatePullRequest({
      prTitle: pr.title,
      prBody: pr.body,
      prDiff: diff,
      evalPrompt: this.config.evalPrompt,
    });

    // Apply policy
    const action = determineEvalAction(evalResponse.score, this.config.thresholds);

    const result: EvalResult = {
      score: evalResponse.score,
      summary: evalResponse.summary,
      breakdown: evalResponse.breakdown,
      action,
    };

    console.log(
      `[eval] PR #${pr.number} scored ${result.score}/100 → ${result.action}`
    );

    // Post comment
    const comment = formatEvalComment(result);
    await this.github.commentOnPullRequest(owner, repo, pr.number, comment);

    // Take action
    switch (result.action) {
      case "approve":
        await this.github.approvePullRequest(
          owner,
          repo,
          pr.number,
          comment
        );
        break;
      case "request_changes":
        await this.github.requestChangesOnPullRequest(
          owner,
          repo,
          pr.number,
          comment
        );
        break;
    }
  }
}
