import { Octokit } from "@octokit/rest";
import {
  GitHubAdapter,
  CopilotChatAdapter,
  CopilotSdkAdapter,
  LoggingChatAdapter,
  MarkdownMemoryAdapter,
  InMemoryOrchestratorAdapter,
} from "@tilsley/adapters";

import { UpgradePackage } from "./application/use-cases/upgrade-package";
import { CopilotResearcherAdapter } from "./adapters/llm/copilot-researcher.adapter";
import { CopilotFixerAdapter } from "./adapters/llm/copilot-fixer.adapter";
import { CopilotDiscoveryAdapter } from "./adapters/llm/copilot-discovery.adapter";
import { CopilotAnalysisAdapter } from "./adapters/llm/copilot-analysis.adapter";
import { GitShellAdapter } from "./adapters/git/git-shell.adapter";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const githubToken = requireEnv("GITHUB_TOKEN");
const copilotToken = process.env["COPILOT_GITHUB_TOKEN"] ?? githubToken;
const owner = requireEnv("TARGET_OWNER");
const repo = requireEnv("TARGET_REPO");
const packageName = process.env["PACKAGE_NAME"]; // optional — omit for auto-discover
const toVersion = process.env["TO_VERSION"];     // optional — omit for auto-discover
const fromVersion = process.env["FROM_VERSION"]; // optional — detected from repo if omitted
const base = process.env["BASE_BRANCH"] ?? "main";
const maxIterations = Number(process.env["MAX_FIX_ITERATIONS"] ?? "5");

console.log(`[upgrade-agent] LLM adapter: claude-sonnet-4.6`);

// --- Infrastructure ---
const octokit = new Octokit({ auth: githubToken });
const github = new GitHubAdapter(octokit);
const rawChat = new CopilotChatAdapter(copilotToken, "claude-sonnet-4.6");
const sdkChat = new CopilotSdkAdapter("claude-sonnet-4.6", copilotToken);
const debug = process.env.LLM_DEBUG;
const llm = (label: string) =>
  debug ? new LoggingChatAdapter(rawChat, label) : rawChat;
const orchestrator = new InMemoryOrchestratorAdapter();
const memoryStore = new MarkdownMemoryAdapter();

// --- Agent adapters (each gets its own logging label) ---
// SDK for researcher (tool use = 1 premium request vs 12+ with raw API)
const researchChat = debug ? new LoggingChatAdapter(sdkChat, "researcher") : sdkChat;
const researchLlm = new CopilotResearcherAdapter(researchChat);
const fixLlm = new CopilotFixerAdapter(llm("fixer"));
const discoveryLlm = new CopilotDiscoveryAdapter(llm("discovery"));
const analysisLlm = new CopilotAnalysisAdapter(llm("analysis"));
const git = new GitShellAdapter();

// --- Use case ---
const upgradePackage = new UpgradePackage(
  git,
  github,
  researchLlm,
  fixLlm,
  orchestrator,
  memoryStore,
  maxIterations,
  discoveryLlm,
  analysisLlm
);

if (packageName && toVersion) {
  console.log(`[upgrade-agent] Upgrading ${owner}/${repo}: ${packageName} → ${toVersion}`);
} else {
  console.log(`[upgrade-agent] Auto-discovering upgrade target in ${owner}/${repo}`);
}

const result = await upgradePackage.execute({
  owner,
  repo,
  token: githubToken,
  packageName,
  toVersion,
  fromVersion,
  base,
});

await sdkChat.stop();

console.log(`[upgrade-agent] Done — status: ${result.status}`);
if (result.prUrl) console.log(`[upgrade-agent] PR: ${result.prUrl}`);
