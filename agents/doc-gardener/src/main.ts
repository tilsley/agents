import { Octokit } from "@octokit/rest";
import {
  GitHubAdapter,
  CopilotSdkAdapter,
  LoggingChatAdapter,
  JsonPolicyAdapter,
} from "@tilsley/adapters";
import type { ReasoningEffort } from "@tilsley/adapters";

import { ScanRepoDocs } from "./application/use-cases/scan-repo-docs";
import { GitShellScannerAdapter } from "./adapters/git/git-shell-scanner.adapter";
import { CopilotDocAnalyzerAdapter } from "./adapters/llm/copilot-doc-analyzer.adapter";
import { CopilotCodeAnalyzerAdapter } from "./adapters/llm/copilot-code-analyzer.adapter";
import { CopilotDocPlannerAdapter } from "./adapters/llm/copilot-doc-planner.adapter";
import { CopilotDocWriterAdapter } from "./adapters/llm/copilot-doc-writer.adapter";
import { CopilotSinglePassFixerAdapter } from "./adapters/llm/copilot-single-pass-fixer.adapter";
import { CopilotAgentFixerAdapter } from "./adapters/llm/copilot-agent-fixer.adapter";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const githubToken = requireEnv("GITHUB_TOKEN");
const copilotToken = process.env["COPILOT_GITHUB_TOKEN"] ?? githubToken;
const owner = requireEnv("TARGET_OWNER");
const repo = requireEnv("TARGET_REPO");
const base = process.env["BASE_BRANCH"] ?? "main";
const maxIterations = parseInt(process.env["MAX_REVIEW_ITERATIONS"] ?? "3", 10);
const strategy = (process.env["STRATEGY"] ?? "agentic") as "agentic" | "single-pass" | "agent";
const reasoningEffort = process.env["REASONING_EFFORT"] as ReasoningEffort | undefined;

console.log(`[doc-gardener] Strategy: ${strategy}`);
console.log(`[doc-gardener] LLM adapter: copilot-sdk (claude-sonnet-4.6)`);
if (reasoningEffort) {
  console.log(`[doc-gardener] Reasoning effort: ${reasoningEffort}`);
}
if (strategy === "agentic") {
  console.log(`[doc-gardener] Max review iterations: ${maxIterations}`);
}

// --- Infrastructure ---
const octokit = new Octokit({ auth: githubToken });
const github = new GitHubAdapter(octokit);
const debug = process.env.LLM_DEBUG;
const policyStore = new JsonPolicyAdapter();
const scanner = new GitShellScannerAdapter();

// Single SDK client instance — each session = 1 premium request
const sdkAdapter = new CopilotSdkAdapter("claude-sonnet-4.6", copilotToken, reasoningEffort);

function makeChat(role: string) {
  return debug ? new LoggingChatAdapter(sdkAdapter, role) : sdkAdapter;
}

// --- Wire based on strategy ---
let scanRepoDocs: ScanRepoDocs;

if (strategy === "agent") {
  const agentFixer = new CopilotAgentFixerAdapter(sdkAdapter);
  scanRepoDocs = new ScanRepoDocs(scanner, github, policyStore, undefined, undefined, agentFixer);
} else if (strategy === "single-pass") {
  const singlePassFixer = new CopilotSinglePassFixerAdapter(makeChat("single-pass-fixer"));
  scanRepoDocs = new ScanRepoDocs(scanner, github, policyStore, undefined, singlePassFixer);
} else {
  const docAnalyzer = new CopilotDocAnalyzerAdapter(makeChat("doc-analyzer"));
  const codeAnalyzer = new CopilotCodeAnalyzerAdapter(makeChat("code-analyzer"));
  const planner = new CopilotDocPlannerAdapter(makeChat("doc-planner"));
  const docWriter = new CopilotDocWriterAdapter(makeChat("doc-writer"));
  scanRepoDocs = new ScanRepoDocs(scanner, github, policyStore, {
    docAnalyzer,
    codeAnalyzer,
    planner,
    docWriter,
  });
}

console.log(
  `[doc-gardener] Scanning ${owner}/${repo} for documentation drift...`
);

const result = await scanRepoDocs.execute({
  owner,
  repo,
  token: githubToken,
  base,
  maxIterations,
  strategy,
});

console.log(`[doc-gardener] Done — status: ${result.status}`);
if (result.prUrl) console.log(`[doc-gardener] PR: ${result.prUrl}`);
if (result.driftItems.length > 0) {
  console.log(`[doc-gardener] Drift items found: ${result.driftItems.length}`);
  const semantic = result.driftItems.filter((d) => d.source === "llm").length;
  const deterministic = result.driftItems.filter(
    (d) => d.source === "deterministic"
  ).length;
  console.log(
    `[doc-gardener]   deterministic: ${deterministic}, semantic: ${semantic}`
  );
}
console.log(`[doc-gardener] Iterations used: ${result.iterationsUsed}`);
if (result.remainingGaps > 0) {
  console.log(
    `[doc-gardener] Remaining gaps: ${result.remainingGaps}`
  );
}

// Shutdown the SDK client
await sdkAdapter.stop();
