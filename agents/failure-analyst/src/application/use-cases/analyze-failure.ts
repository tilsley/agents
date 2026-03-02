import type { CheckRun, GitHubPort, PullRequest } from "@tilsley/shared";
import type { ClassifierLlmPort, ClassificationContext } from "../ports/classifier-llm.port";
import type { ConductorPort } from "../ports/conductor.port";
import type { FailureAnalysis } from "../../domain/entities/failure-analysis";
import {
  classifyByHeuristic,
  mapCategoryToDecision,
  shouldTrustLlmClassification,
} from "../../domain/policies/classification-policy";
import { shouldEscalateRetry } from "../../domain/policies/retry-policy";
import type { RetryTrackerPort } from "../../adapters/state/in-memory-retry-tracker";

export interface AnalyzeFailureInput {
  owner: string;
  repo: string;
  headSha: string;
  checkRuns: CheckRun[];
}

export class AnalyzeFailure {
  constructor(
    private github: GitHubPort,
    private classifierLlm: ClassifierLlmPort,
    private conductor: ConductorPort,
    private retryTracker: RetryTrackerPort,
    private maxRetries: number = 3
  ) {}

  async execute(input: AnalyzeFailureInput): Promise<FailureAnalysis[]> {
    const { owner, repo, headSha, checkRuns } = input;

    // 1. Look up PR
    const pr = await this.github.getPullRequestForCheckRun(owner, repo, headSha);
    if (!pr) {
      console.log(`[failure-analyst:skip] No PR found for sha: ${headSha}`);
      return [];
    }

    // 2. Filter to failed checks
    const failedChecks = checkRuns.filter(
      (cr) => cr.conclusion === "failure" || cr.conclusion === "timed_out"
    );

    if (failedChecks.length === 0) {
      console.log(`[failure-analyst:skip] No failed checks for PR #${pr.number}`);
      return [];
    }

    // 3. Try heuristic classification first
    const heuristicResults: Map<number, FailureAnalysis> = new Map();
    const needsLlm: CheckRun[] = [];

    for (const check of failedChecks) {
      const output = [check.output.title, check.output.summary, check.output.text]
        .filter(Boolean)
        .join("\n\n");

      const heuristic = classifyByHeuristic(check.name, output);
      if (heuristic) {
        const retryCount = this.retryTracker.getCount(
          this.makeTrackerKey(owner, repo, pr.number, check.name, headSha)
        );
        const decision = mapCategoryToDecision({
          category: heuristic.category,
          retryCount,
          maxRetries: this.maxRetries,
        });

        heuristicResults.set(check.id, {
          checkRunId: check.id,
          checkName: check.name,
          category: heuristic.category,
          decision,
          signature: {
            checkName: check.name,
            errorType: heuristic.errorType,
            errorPattern: heuristic.errorPattern,
            category: heuristic.category,
            confidence: heuristic.confidence,
          },
          reasoning: `Heuristic match: ${heuristic.errorType} (${heuristic.errorPattern})`,
        });
      } else {
        needsLlm.push(check);
      }
    }

    // 4. Call ClassifierLlmPort for unclassified checks
    if (needsLlm.length > 0) {
      const contexts: ClassificationContext[] = await Promise.all(
        needsLlm.map(async (check) => {
          const [annotations, log] = await Promise.all([
            this.github.getCheckRunAnnotations(owner, repo, check.id),
            this.github.getCheckRunLog(owner, repo, check.id),
          ]);

          const checkOutput = [check.output.title, check.output.summary, check.output.text]
            .filter(Boolean)
            .join("\n\n");

          return {
            checkName: check.name,
            checkRunId: check.id,
            checkOutput: [checkOutput, annotations].filter(Boolean).join("\n\n"),
            checkLog: log,
            prTitle: pr.title,
            prBody: pr.body,
          };
        })
      );

      const llmResults = await this.classifierLlm.classifyFailures(contexts);

      for (const result of llmResults) {
        const check = needsLlm.find((c) => c.id === result.checkRunId);
        if (!check) continue;

        const category = shouldTrustLlmClassification(result.confidence)
          ? result.category
          : "unknown";

        const retryCount = this.retryTracker.getCount(
          this.makeTrackerKey(owner, repo, pr.number, check.name, headSha)
        );
        const decision = mapCategoryToDecision({
          category,
          retryCount,
          maxRetries: this.maxRetries,
        });

        heuristicResults.set(check.id, {
          checkRunId: check.id,
          checkName: check.name,
          category,
          decision,
          signature: {
            checkName: check.name,
            errorType: result.errorType,
            errorPattern: result.errorPattern,
            category,
            confidence: result.confidence,
          },
          reasoning: result.reasoning,
        });
      }
    }

    const analyses = Array.from(heuristicResults.values());

    // 5. Execute immediate actions + emit results
    for (const analysis of analyses) {
      if (analysis.decision === "retry") {
        const trackerKey = this.makeTrackerKey(
          owner, repo, pr.number, analysis.checkName, headSha
        );
        const count = this.retryTracker.getCount(trackerKey);

        if (shouldEscalateRetry(count, this.maxRetries)) {
          analysis.decision = "escalate";
          console.log(
            `[failure-analyst:escalate] ${analysis.checkName} on PR #${pr.number} hit retry limit (${count}/${this.maxRetries})`
          );
        } else {
          this.retryTracker.increment(trackerKey);
          console.log(
            `[failure-analyst:retry] ${analysis.checkName} on PR #${pr.number}`
          );
          await this.github.rerunCheckRun(owner, repo, analysis.checkRunId);
        }
      }
    }

    // 6. Emit results via conductor
    await this.conductor.emit({
      type: "failure-analysis.completed",
      payload: {
        owner,
        repo,
        prNumber: pr.number,
        headSha,
        analyses,
      },
      timestamp: new Date(),
      correlationId: `${owner}/${repo}#${pr.number}:${headSha}`,
    });

    return analyses;
  }

  private makeTrackerKey(
    owner: string,
    repo: string,
    prNumber: number,
    checkName: string,
    headSha: string
  ): string {
    return `${owner}/${repo}#${prNumber}:${checkName}:${headSha}`;
  }
}
