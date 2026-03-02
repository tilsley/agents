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

    // 3. Run heuristics to build hints — passed to the LLM as signals, not hard answers
    const heuristicHints = new Map<number, ReturnType<typeof classifyByHeuristic>>();
    for (const check of failedChecks) {
      const output = [check.output.title, check.output.summary, check.output.text]
        .filter(Boolean)
        .join("\n\n");
      const hint = classifyByHeuristic(check.name, output);
      if (hint) heuristicHints.set(check.id, hint);
    }

    // 4. Always call the LLM for every failed check.
    //    Heuristic hints are threaded into the prompt so the LLM can confirm or override.
    const contexts: ClassificationContext[] = await Promise.all(
      failedChecks.map(async (check) => {
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
          heuristicHint: heuristicHints.get(check.id) ?? null,
        };
      })
    );

    const llmResults = await this.classifierLlm.classifyFailures(contexts);

    const analysisResults: Map<number, FailureAnalysis> = new Map();

    for (const result of llmResults) {
      const check = failedChecks.find((c) => c.id === result.checkRunId);
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

      analysisResults.set(check.id, {
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

    const analyses = Array.from(analysisResults.values());

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
