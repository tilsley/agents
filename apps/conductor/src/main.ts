import { Hono } from "hono";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import type { CheckRun, FailureSignature, PullRequest } from "@tilsley/shared";

// Conductor adapters
import { GitHubAdapter } from "./adapters/github/github.adapter";
import { InMemoryOrchestratorAdapter } from "./adapters/orchestrator/in-memory-orchestrator.adapter";
import { CopilotChatAdapter } from "./adapters/llm/copilot-chat.adapter";
import { MarkdownMemoryAdapter } from "./adapters/memory/markdown-memory.adapter";
import { KnowledgeAdapter } from "./adapters/memory/knowledge.adapter";
import { createConductorWebhookServer } from "./adapters/http/webhook.server";
import { createApiRouter } from "./adapters/http/api.server";

// Conductor use cases
import { HandleWebhook } from "./application/use-cases/handle-webhook";
import { HandleAgentCompletion } from "./application/use-cases/handle-agent-completion";
import { RouteEvent, type AgentDispatcher } from "./application/use-cases/route-event";

import type { AgentType } from "./domain/entities/agent-assignment";
import { getChecklist } from "./domain/policies/checklist-policy";
import { getDistillationFocus } from "./domain/policies/distillation-focus-policy";
import type { AgentTask } from "@tilsley/shared";

// Failure Analyst
import { AnalyzeFailure } from "@tilsley/failure-analyst/src/application/use-cases/analyze-failure";
import { CopilotClassifierAdapter } from "@tilsley/failure-analyst/src/adapters/llm/copilot-classifier.adapter";
import { InMemoryRetryTracker } from "@tilsley/failure-analyst/src/adapters/state/in-memory-retry-tracker";

// Review Agent
import { EvaluatePr } from "@tilsley/review-agent/src/application/use-cases/evaluate-pr";
import { CopilotReviewerAdapter } from "@tilsley/review-agent/src/adapters/llm/copilot-reviewer.adapter";

// Distiller
import { DistillLessons } from "@tilsley/distiller/src/application/use-cases/distill-lessons";
import { CopilotSummarizerAdapter } from "@tilsley/distiller/src/adapters/llm/copilot-summarizer.adapter";
import { CopilotConsolidatorAdapter } from "@tilsley/distiller/src/adapters/llm/copilot-consolidator.adapter";

// --- Environment ---

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const appId = requireEnv("GITHUB_APP_ID");
const privateKey = requireEnv("GITHUB_PRIVATE_KEY");
const webhookSecret = requireEnv("GITHUB_WEBHOOK_SECRET");
const installationId = Number(requireEnv("GITHUB_INSTALLATION_ID"));
const port = Number(process.env["PORT"] ?? "3000");
const maxRetries = Number(process.env["MAX_RETRIES"] ?? "3");
const copilotToken = requireEnv("COPILOT_GITHUB_TOKEN");
console.log(`[conductor] Copilot token prefix: ${copilotToken.slice(0, 6)}...`);

// --- Infrastructure adapters ---

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: { appId, privateKey, installationId },
});

const github = new GitHubAdapter(octokit);
const chatCompletion = new CopilotChatAdapter(copilotToken, "claude-sonnet-4.6");
const memoryStore = new MarkdownMemoryAdapter();
const retryTracker = new InMemoryRetryTracker();
const orchestrator = new InMemoryOrchestratorAdapter();

// --- Agent adapters ---

const classifierLlm = new CopilotClassifierAdapter(chatCompletion);
const reviewerLlm = new CopilotReviewerAdapter(chatCompletion);
const summarizerLlm = new CopilotSummarizerAdapter(chatCompletion);
const consolidatorLlm = new CopilotConsolidatorAdapter(chatCompletion);
const knowledge = new KnowledgeAdapter(memoryStore);

// --- Agent use cases ---

const analyzeFailure = new AnalyzeFailure(
  github,
  classifierLlm,
  orchestrator,
  retryTracker,
  maxRetries
);

const evaluatePr = new EvaluatePr(
  github,
  reviewerLlm,
  knowledge,
  orchestrator
);

const distillLessons = new DistillLessons(summarizerLlm, consolidatorLlm, memoryStore, orchestrator);

// --- Pipeline context accumulator ---
// Threads context across pipeline stages without a database.
// Keyed by correlationId (owner/repo#prNumber:headSha).

interface PipelineContext {
  owner: string;
  repo: string;
  headSha: string;
  prNumber?: number;
  prAuthor?: string;
  prTitle?: string;
  taskType?: string;
  pr?: PullRequest;
  failureSignatures: FailureSignature[];
  reviewScore?: number;
  reviewDecision?: string;
  reviewFeedback?: string;
  diff?: string;
}

const pipelineContexts = new Map<string, PipelineContext>();

// --- Conductor use cases ---

const handleWebhook = new HandleWebhook(orchestrator);
const handleAgentCompletion = new HandleAgentCompletion(orchestrator);

// --- Agent dispatcher ---
// The dispatcher is the bridge between RouteEvent and the agent use cases.
// Each branch extracts its typed payload, runs the use case, and accumulates
// context for downstream stages. Errors are routed to HandleAgentCompletion
// so the pipeline can emit pipeline.failed rather than silently dying.

const dispatch: AgentDispatcher = async (
  agentType: AgentType,
  task: AgentTask
): Promise<void> => {
  const payload = task.payload as Record<string, unknown>;
  const correlationId = payload.correlationId as string;

  try {
    if (agentType === "context-store") {
      // Store PR metadata so it's available when check_run.passed/failed arrives
      // for the same headSha. No agent is invoked — this is purely a context accumulation step.
      const owner = payload.owner as string;
      const repo = payload.repo as string;
      const headSha = (payload.headSha as string | undefined) ?? "";
      const prNumber = payload.prNumber as number | undefined;
      const prAuthor = (payload.prAuthor as string | undefined) ?? "";
      const prTitle = (payload.prTitle as string | undefined) ?? "";

      pipelineContexts.set(correlationId, {
        owner,
        repo,
        headSha,
        prNumber,
        prAuthor,
        prTitle,
        failureSignatures: [],
      });

      console.log(
        `[conductor:context-store] Stored PR context for ${correlationId} (PR #${prNumber} by ${prAuthor})`
      );
    } else if (agentType === "failure-analyst") {
      const owner = payload.owner as string;
      const repo = payload.repo as string;
      const headSha = payload.headSha as string;
      const checkRun = payload.checkRun as CheckRun;

      // Merge into existing context (set by context-store on pull_request.opened)
      // so we keep prAuthor/prTitle if they arrived first.
      const existing = pipelineContexts.get(correlationId);
      pipelineContexts.set(correlationId, {
        owner,
        repo,
        headSha,
        prAuthor: existing?.prAuthor,
        prTitle: existing?.prTitle,
        prNumber: existing?.prNumber,
        failureSignatures: [],
      });

      const analyses = await analyzeFailure.execute({
        owner,
        repo,
        headSha,
        checkRuns: [checkRun],
      });

      const ctx = pipelineContexts.get(correlationId);
      if (ctx) {
        ctx.failureSignatures = analyses.map((a) => a.signature);
      }
    } else if (agentType === "review-agent") {
      const owner = payload.owner as string;
      const repo = payload.repo as string;
      const headSha = (payload.headSha as string | undefined) ?? "";

      // Resolve prNumber from payload (failure-analysis path) or stored context
      // (check_run.passed path where context-store ran on pull_request.opened).
      let prNumber = payload.prNumber as number | undefined;
      let prAuthor = (payload.prAuthor as string | undefined) ?? "";
      let prTitle = (payload.prTitle as string | undefined) ?? "";

      const ctx = pipelineContexts.get(correlationId);
      if (ctx) {
        prNumber ??= ctx.prNumber;
        prAuthor ||= ctx.prAuthor ?? "";
        prTitle ||= ctx.prTitle ?? "";
      }

      // Last resort: ask GitHub (covers the case where pull_request.opened
      // webhook was not forwarded before the check_run fired).
      if (!prNumber) {
        const pr = await github.getPullRequestForCheckRun(owner, repo, headSha);
        if (pr) {
          prNumber = pr.number;
          prAuthor ||= pr.author ?? "";
          prTitle ||= pr.title ?? "";
        }
      }

      if (!prNumber) {
        console.warn(
          `[conductor:review-agent] Could not resolve PR number for ${correlationId} — skipping`
        );
        return;
      }

      if (ctx) {
        ctx.prNumber = prNumber;
        ctx.prAuthor = prAuthor;
        ctx.prTitle = prTitle;
      } else {
        pipelineContexts.set(correlationId, {
          owner,
          repo,
          headSha,
          prNumber,
          prAuthor,
          prTitle,
          failureSignatures: [],
        });
      }

      const checklist = getChecklist(prAuthor, prTitle);
      console.log(`[conductor] Using checklist: ${checklist.taskType} (PR by ${prAuthor || "unknown"})`);

      if (ctx) ctx.taskType = checklist.taskType;
      else pipelineContexts.get(correlationId)!.taskType = checklist.taskType;

      const result = await evaluatePr.execute({
        owner,
        repo,
        prNumber,
        headSha,
        checklist,
        correlationId,
        failureSignatures: pipelineContexts.get(correlationId)?.failureSignatures,
      });

      if (result) {
        const ctx2 = pipelineContexts.get(correlationId);
        if (ctx2) {
          ctx2.reviewScore = result.overallScore;
          ctx2.reviewDecision = result.decision;
          ctx2.reviewFeedback = result.feedback;
        }
      }
    } else if (agentType === "distiller") {
      const owner = payload.owner as string;
      const repo = payload.repo as string;
      const prNumber = payload.prNumber as number;

      const ctx = pipelineContexts.get(correlationId);

      // Fetch PR + diff from GitHub to build the full PipelineSummary
      const headSha = ctx?.headSha ?? "";
      const [pr, diff] = await Promise.all([
        github.getPullRequestForCheckRun(owner, repo, headSha),
        github.getPullRequestDiff(owner, repo, prNumber),
      ]);

      if (!pr) {
        console.log(
          `[conductor:distiller] No PR found for ${correlationId}, skipping distillation`
        );
        return;
      }

      const distillFocus = getDistillationFocus(
        ctx?.prAuthor ?? "",
        ctx?.prTitle ?? ""
      );

      if (distillFocus) {
        console.log(`[conductor] Distillation focus: ${distillFocus.slice(0, 60)}...`);
      }

      await distillLessons.execute({
        summary: {
          pullRequest: pr,
          headSha,
          failureSignatures: ctx?.failureSignatures ?? [],
          reviewScore: ctx?.reviewScore ?? 0,
          reviewDecision: ctx?.reviewDecision ?? "unknown",
          reviewFeedback: ctx?.reviewFeedback ?? "",
          diff: diff ?? "",
          metadata: {},
        },
        correlationId,
        focus: distillFocus,
        agentType: ctx?.taskType,
      });

      // Pipeline complete — clean up context
      pipelineContexts.delete(correlationId);
    }
  } catch (err) {
    console.error(
      `[conductor] Agent ${agentType} failed for task ${task.taskId}:`,
      err
    );
    await handleAgentCompletion.execute(
      task.type,
      { taskId: task.taskId, status: "failure", output: { error: String(err) } },
      correlationId
    );
  }
};

// --- Start pipeline ---

const routeEvent = new RouteEvent(orchestrator, dispatch);
routeEvent.start();

// --- Start webhook server ---

const webhookApp = createConductorWebhookServer({ webhookSecret, handleWebhook });
const apiApp = createApiRouter();

const app = new Hono();
app.route("/", webhookApp);
app.route("/", apiApp);

console.log(`[conductor] Starting on port ${port}`);
console.log(`[conductor] Webhook endpoint: POST /webhook`);
console.log(`[conductor] Health endpoint:  GET  /health`);

export default {
  port,
  fetch: app.fetch,
};
