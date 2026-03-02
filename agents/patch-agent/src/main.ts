/**
 * patch-agent — standalone runner
 *
 * Scans a target repo with Snyk, patches upgradable vulnerabilities,
 * and opens a PR. The PR then enters the conductor pipeline normally.
 *
 * Usage (env vars):
 *   GITHUB_TOKEN        Personal access token or GitHub App installation token
 *   SNYK_TOKEN          Snyk API token (https://app.snyk.io/account) — skips `snyk auth`
 *   TARGET_OWNER        Repository owner (e.g. "tilsley")
 *   TARGET_REPO         Repository name (e.g. "agents")
 *   TARGET_BASE         Branch to open PR against (default: main)
 *   MIN_SEVERITY        Minimum severity to patch: critical|high|medium|low (default: high)
 */
import { PatchVulnerabilities } from "./application/use-cases/patch-vulnerabilities";
import { SnykCliAdapter } from "./adapters/snyk/snyk-cli.adapter";
import { GitShellAdapter } from "./adapters/git/git-shell.adapter";
import { CopilotChatAdapter } from "./adapters/llm/copilot-chat.adapter";
import { CopilotPatchAdvisorAdapter } from "./adapters/llm/copilot-patch-advisor.adapter";
import { MarkdownMemoryReaderAdapter } from "./adapters/memory/markdown-memory-reader.adapter";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const token = requireEnv("GITHUB_TOKEN");
const owner = requireEnv("TARGET_OWNER");
const repo = requireEnv("TARGET_REPO");
const minSeverity = (process.env["MIN_SEVERITY"] ?? "high") as
  | "critical"
  | "high"
  | "medium"
  | "low";

// No-op conductor — when running standalone the PR creation is the end goal.
// Wire to the real conductor if you want the review pipeline to trigger immediately.
const noopConductor = {
  async emit() {},
};

const snykToken = requireEnv("SNYK_TOKEN");
const snyk = new SnykCliAdapter(snykToken);
const git = new GitShellAdapter();

const copilotToken = process.env["COPILOT_GITHUB_TOKEN"];
const memory = new MarkdownMemoryReaderAdapter();
const advisor = copilotToken
  ? new CopilotPatchAdvisorAdapter(new CopilotChatAdapter(copilotToken))
  : undefined;

if (advisor) {
  console.log("[patch-agent] LLM advisor enabled — will load lessons before patching");
} else {
  console.log("[patch-agent] LLM advisor disabled (set COPILOT_GITHUB_TOKEN to enable)");
}

// GitHubPort — provide your own implementation or use the conductor's GitHubAdapter
// with an Octokit instance authenticated via a personal access token.
//
// Minimal inline implementation for standalone use:
const { Octokit } = await import("@octokit/rest");
const octokit = new Octokit({ auth: token });

// Use TARGET_BASE if set; otherwise query the repo's actual default branch.
const base =
  process.env["TARGET_BASE"] ??
  await octokit.repos.get({ owner, repo }).then((r) => r.data.default_branch);

const github = {
  async createPullRequest(
    o: string,
    r: string,
    opts: { title: string; body: string; head: string; base: string }
  ) {
    const { data } = await octokit.pulls.create({
      owner: o,
      repo: r,
      ...opts,
    });
    return { number: data.number, url: data.html_url };
  },
  // Remaining GitHubPort methods unused in patch-agent
  getPullRequestForCheckRun: async () => null,
  getCheckRunAnnotations: async () => "",
  getCheckRunLog: async () => "",
  rerunCheckRun: async () => {},
  closePullRequest: async () => {},
  getCheckRunsForRef: async () => [],
  getPullRequestDiff: async () => "",
  commentOnPullRequest: async () => {},
  approvePullRequest: async () => {},
  requestChangesOnPullRequest: async () => {},
  mergePullRequest: async () => {},
};

const useCase = new PatchVulnerabilities(snyk, git, github, noopConductor, memory, advisor);

console.log(`[patch-agent] Scanning ${owner}/${repo} (min severity: ${minSeverity})`);

const result = await useCase.execute({ owner, repo, token, base, minSeverity });

if (result.status === "clean") {
  console.log("[patch-agent] Repo is clean — nothing to do.");
} else if (result.status === "no-fixable-vulns") {
  console.log("[patch-agent] Vulnerabilities found but none are auto-fixable at this severity threshold.");
} else {
  console.log(`[patch-agent] Done. PR #${result.prNumber}: ${result.prUrl}`);
}
