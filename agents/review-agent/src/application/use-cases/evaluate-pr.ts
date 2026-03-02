import type { GitHubPort, PullRequest, ReviewChecklist, FailureSignature } from "@tilsley/shared";
import type { ReviewerLlmPort } from "../ports/reviewer-llm.port";
import type { KnowledgePort } from "../ports/knowledge.port";
import type { ConductorPort } from "../ports/conductor.port";
import type { ReviewResult } from "../../domain/entities/review-result";
import {
  makeReviewDecision,
  calculateOverallScore,
  type ReviewThresholds,
} from "../../domain/policies/review-policy";

export interface EvaluatePrInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  checklist: ReviewChecklist;
  correlationId: string;
  failureSignatures?: FailureSignature[];
}

export class EvaluatePr {
  constructor(
    private github: GitHubPort,
    private reviewerLlm: ReviewerLlmPort,
    private knowledge: KnowledgePort,
    private conductor: ConductorPort,
    private thresholds?: ReviewThresholds
  ) {}

  async execute(input: EvaluatePrInput): Promise<ReviewResult | null> {
    const { owner, repo, prNumber, headSha, checklist, correlationId, failureSignatures } = input;

    // 1. Fetch PR details and diff
    const pr = await this.github.getPullRequestForCheckRun(owner, repo, headSha);
    if (!pr) {
      // Try to construct minimal PR info
      console.log(`[review-agent:skip] Could not find PR #${prNumber}`);
      return null;
    }

    const diff = await this.github.getPullRequestDiff(owner, repo, prNumber);
    if (!diff) {
      console.log(`[review-agent:skip] No diff for PR #${prNumber}`);
      return null;
    }

    // 2. Query RAG for relevant context
    const [lessons, pastReviews] = await Promise.all([
      this.knowledge.findRelevantLessons(
        `${pr.title} ${checklist.taskType}`,
        checklist.taskType,
        checklist.taskType,
        repo
      ),
      this.knowledge.findPastReviews(repo, checklist.taskType),
    ]);

    if (lessons.length > 0) {
      console.log(`[review-agent] Loaded ${lessons.length} lesson(s) from memory:`);
      for (const l of lessons) console.log(`  - ${l.problem}`);
    } else {
      console.log(`[review-agent] No lessons in memory yet for this query`);
    }

    // 3. Score via LLM
    const scores = await this.reviewerLlm.evaluateChecklist({
      prTitle: pr.title,
      prBody: pr.body,
      diff,
      checklist,
      relevantLessons: lessons,
      failureSignatures,
    });

    // 4. Calculate overall score
    const weightedScores = scores.map((s) => {
      const item = checklist.items.find((i) => i.id === s.itemId);
      return { score: s.score, weight: item?.weight ?? 1 };
    });
    const overallScore = calculateOverallScore(weightedScores);

    // 5. Make decision
    const decision = makeReviewDecision(overallScore, this.thresholds);

    const result: ReviewResult = {
      checklistScores: scores,
      overallScore,
      decision,
      feedback: this.buildFeedback(scores, decision),
    };

    // 6. Post review via GitHub
    const { formatReviewComment } = await import(
      "../../domain/utils/format-review-comment"
    );
    const comment = formatReviewComment(result);

    if (decision === "approve") {
      await this.github.approvePullRequest(owner, repo, prNumber, comment);
    } else if (decision === "request_changes") {
      await this.github.requestChangesOnPullRequest(
        owner,
        repo,
        prNumber,
        comment
      );
    } else {
      await this.github.commentOnPullRequest(owner, repo, prNumber, comment);
    }

    console.log(`[review-agent] PR #${prNumber} scored ${overallScore}/100 → ${decision}`);
    for (const s of scores) {
      console.log(`  [${s.label}] ${s.score}/100 — ${s.reasoning}`);
    }

    // 7. Emit results back to conductor
    await this.conductor.emit({
      type: "review.completed",
      payload: {
        owner,
        repo,
        prNumber,
        result,
      },
      timestamp: new Date(),
      correlationId,
    });

    return result;
  }

  private buildFeedback(
    scores: Array<{ score: number; reasoning: string; label: string }>,
    decision: string
  ): string {
    const lowScores = scores.filter((s) => s.score < 50);
    if (lowScores.length === 0) return "All criteria meet expectations.";

    return lowScores
      .map((s) => `- **${s.label}** (${s.score}/100): ${s.reasoning}`)
      .join("\n");
  }
}
