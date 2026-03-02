import type { CheckRun } from "../../domain/entities/check-run";
import { shouldProcess } from "../../domain/policies/review-policy";
import { shouldEscalateRerun } from "../../domain/policies/rerun-policy";
import type { GitHubPort } from "../ports/github.port";
import type { LlmPort, CheckFailureContext } from "../ports/llm.port";
import type { RerunTrackerPort } from "../ports/rerun-tracker.port";
import { InMemoryRerunTracker } from "../../adapters/state/in-memory-rerun-tracker";

export interface CheckRunEvent {
  owner: string;
  repo: string;
  checkRun: CheckRun;
}

export class HandleCheckRunCompleted {
  constructor(
    private github: GitHubPort,
    private llm: LlmPort,
    private botUsername: string,
    private rerunTracker: RerunTrackerPort = new InMemoryRerunTracker(),
    private maxReruns: number = 3
  ) {}

  async execute(event: CheckRunEvent): Promise<void> {
    return this.executeBatch([event]);
  }

  async executeBatch(events: CheckRunEvent[]): Promise<void> {
    if (events.length === 0) return;

    // All events share the same headSha, so use the first to look up the PR
    const { owner, repo } = events[0];
    const headSha = events[0].checkRun.headSha;

    const pr = await this.github.getPullRequestForCheckRun(
      owner,
      repo,
      headSha
    );

    if (!pr) {
      console.log(
        `[skip] No PR found for check runs (sha: ${headSha})`
      );
      return;
    }

    // Filter to actionable checks
    const actionableEvents = events.filter((e) =>
      shouldProcess(pr.author, this.botUsername, e.checkRun.conclusion)
    );

    if (actionableEvents.length === 0) {
      console.log(
        `[skip] PR #${pr.number} by ${pr.author} — no actionable checks`
      );
      return;
    }

    // Fetch annotations and logs for all checks in parallel
    const checksWithContext = await Promise.all(
      actionableEvents.map(async (e) => {
        const [annotations, log] = await Promise.all([
          this.github.getCheckRunAnnotations(owner, repo, e.checkRun.id),
          this.github.getCheckRunLog(owner, repo, e.checkRun.id),
        ]);

        const checkOutput = [
          e.checkRun.output.title,
          e.checkRun.output.summary,
          e.checkRun.output.text,
        ]
          .filter(Boolean)
          .join("\n\n");

        return {
          event: e,
          context: {
            checkName: e.checkRun.name,
            checkRunId: e.checkRun.id,
            checkOutput: [checkOutput, annotations].filter(Boolean).join("\n\n"),
            checkLog: log,
          } satisfies CheckFailureContext,
        };
      })
    );

    // Single LLM call for all checks
    const decisions = await this.llm.analyzeCheckFailure({
      prTitle: pr.title,
      prBody: pr.body,
      checks: checksWithContext.map((c) => c.context),
    });

    // Process each decision with rerun limit enforcement
    for (const decision of decisions) {
      const matchingEvent = checksWithContext.find(
        (c) => c.event.checkRun.id === decision.checkRunId
      );
      const checkRun = matchingEvent?.event.checkRun;
      const checkName = checkRun?.name ?? `check#${decision.checkRunId}`;

      let finalDecision = decision;

      // Enforce rerun limit
      if (finalDecision.action === "rerun" && checkRun) {
        const trackerKey = InMemoryRerunTracker.makeKey(
          owner,
          repo,
          pr.number,
          checkName,
          headSha
        );
        const count = this.rerunTracker.getCount(trackerKey);

        if (shouldEscalateRerun(count, this.maxReruns)) {
          console.log(
            `[escalate] Check ${checkName} on PR #${pr.number} hit rerun limit (${count}/${this.maxReruns})`
          );
          finalDecision = {
            action: "close",
            reason: `Rerun limit reached (${count}/${this.maxReruns}). Closing PR to prevent infinite reruns.`,
            checkRunId: decision.checkRunId,
          };
        } else {
          this.rerunTracker.increment(trackerKey);
        }
      }

      switch (finalDecision.action) {
        case "rerun":
          console.log(
            `[rerun] Check ${checkName} on PR #${pr.number}: ${finalDecision.reason}`
          );
          await this.github.rerunCheckRun(owner, repo, finalDecision.checkRunId);
          break;

        case "close":
          console.log(
            `[close] PR #${pr.number}: ${finalDecision.reason}`
          );
          await this.github.closePullRequest(
            owner,
            repo,
            pr.number,
            finalDecision.reason
          );
          // Stop processing remaining decisions
          return;

        case "skip":
          console.log(
            `[skip] Check ${checkName} on PR #${pr.number}: ${finalDecision.reason}`
          );
          break;
      }
    }
  }
}
