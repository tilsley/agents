import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { GitHubAdapter } from "./adapters/github/github.adapter";
import { CopilotAdapter } from "./adapters/llm/copilot.adapter";
import { HandleCheckRunCompleted } from "./application/use-cases/handle-check-run-completed";
import { HandlePrEval } from "./application/use-cases/handle-pr-eval";
import { createWebhookServer } from "./adapters/http/webhook.server";
import { InMemoryRerunTracker } from "./adapters/state/in-memory-rerun-tracker";
import { DebounceBuffer } from "./adapters/state/debounce-buffer";
import type { CheckRunEvent } from "./application/use-cases/handle-check-run-completed";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const appId = requireEnv("GITHUB_APP_ID");
const privateKey = Buffer.from(
  requireEnv("GITHUB_PRIVATE_KEY"),
  "base64"
).toString("utf-8");
const webhookSecret = requireEnv("GITHUB_WEBHOOK_SECRET");
const installationId = Number(requireEnv("GITHUB_INSTALLATION_ID"));
const botUsername = requireEnv("BOT_USERNAME");
const copilotToken = requireEnv("COPILOT_TOKEN");
const port = Number(process.env["PORT"] ?? "3000");
const maxReruns = Number(process.env["MAX_RERUNS"] ?? "3");
const debounceWindowMs = Number(process.env["DEBOUNCE_WINDOW_MS"] ?? "5000");

// Eval config (opt-in: disabled when EVAL_PROMPT is empty)
const evalPrompt = process.env["EVAL_PROMPT"] ?? "";
const evalApproveAbove = Number(process.env["EVAL_APPROVE_ABOVE"] ?? "80");
const evalRequestChangesBelow = Number(
  process.env["EVAL_REQUEST_CHANGES_BELOW"] ?? "40"
);
const evalDebounceWindowMs = Number(
  process.env["EVAL_DEBOUNCE_WINDOW_MS"] ?? "10000"
);

const octokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId,
    privateKey,
    installationId,
  },
});

const github = new GitHubAdapter(octokit);
const llm = new CopilotAdapter({ token: copilotToken });
const rerunTracker = new InMemoryRerunTracker(60 * 60 * 1000);
const eventBuffer = new DebounceBuffer<CheckRunEvent>(debounceWindowMs);
const useCase = new HandleCheckRunCompleted(
  github,
  llm,
  botUsername,
  rerunTracker,
  maxReruns
);

// Conditionally wire eval use case
let evalUseCase: HandlePrEval | undefined;
let evalEventBuffer: DebounceBuffer<CheckRunEvent> | undefined;

if (evalPrompt) {
  evalEventBuffer = new DebounceBuffer<CheckRunEvent>(evalDebounceWindowMs);
  evalUseCase = new HandlePrEval(github, llm, {
    botUsername,
    evalPrompt,
    thresholds: {
      approveAbove: evalApproveAbove,
      requestChangesBelow: evalRequestChangesBelow,
    },
  });
  console.log(
    `Eval enabled: approve above ${evalApproveAbove}, request changes below ${evalRequestChangesBelow}`
  );
}

const app = createWebhookServer({
  webhookSecret,
  useCase,
  eventBuffer,
  evalUseCase,
  evalEventBuffer,
});

console.log(`Reviewer agent starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
