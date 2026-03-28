import type { GitHubPort, MemoryPort, Lesson, MemoryDocument } from "@tilsley/shared";
import type { ResearchLlmPort, RawResearch } from "../ports/research-llm.port";
import type { FixLlmPort } from "../ports/fix-llm.port";
import type { UpgradeGitPort } from "../ports/upgrade-git.port";
import type { ConductorPort } from "../ports/conductor.port";
import type { DiscoveryLlmPort, UpgradeCandidate } from "../ports/discovery-llm.port";
import type { AnalysisLlmPort } from "../ports/analysis-llm.port";
import type { UpgradeTarget } from "../../domain/entities/upgrade-target";
import type { UpgradePlan } from "../../domain/entities/upgrade-plan";
import type { UpgradeResult } from "../../domain/entities/upgrade-result";
import type { CodebaseAnalysis, UsageSite } from "../../domain/entities/codebase-analysis";
import { deriveRiskLevel } from "../../domain/policies/risk-policy";
import { buildChangelogUrl } from "../../domain/policies/search-query-policy";
import { formatPrBody } from "../../domain/utils/format-pr-body";
import { createResearcherToolExecutor } from "../../domain/tools/researcher-tools";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

export interface UpgradePackageInput {
  owner: string;
  repo: string;
  token: string;
  /** Omit to enable auto-discover mode — the agent picks the best outdated dep. */
  packageName?: string;
  /** Omit to enable auto-discover mode. */
  toVersion?: string;
  /** If omitted, the agent reads the current version from the cloned repo. */
  fromVersion?: string;
  /** PR base branch (default: main). */
  base?: string;
}

export class UpgradePackage {
  constructor(
    private git: UpgradeGitPort,
    private github: GitHubPort,
    private researchLlm: ResearchLlmPort,
    private fixLlm: FixLlmPort,
    private conductor: ConductorPort,
    private memory?: MemoryPort,
    private maxIterations: number = 5,
    private discovery?: DiscoveryLlmPort,
    private analysisLlm?: AnalysisLlmPort
  ) {}

  async execute(input: UpgradePackageInput): Promise<UpgradeResult> {
    const { owner, repo, token, base = "main" } = input;

    const tempParent = await this.makeTempDir(owner, repo);
    const workDir = path.join(tempParent, repo);

    try {
      // 1. Clone
      const repoUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      await this.git.cloneRepo(repoUrl, workDir);
      console.log(`[upgrade-agent] Cloned ${owner}/${repo} to ${workDir}`);

      // 1b. Auto-discover target if not specified
      let packageName = input.packageName;
      let toVersion = input.toVersion;

      if (!packageName || !toVersion) {
        console.log(`[upgrade-agent] No package specified — running auto-discovery`);
        const discovered = await this.discoverTarget(workDir);
        if (!discovered) {
          console.log(`[upgrade-agent] No suitable upgrade candidates found`);
          return { status: "no-candidates" };
        }
        packageName = discovered.packageName;
        toVersion = discovered.toVersion;
      }

      // 2. Resolve fromVersion
      const fromVersion =
        input.fromVersion ?? (await this.git.getInstalledVersion(workDir, packageName));

      if (!fromVersion) {
        throw new Error(
          `[upgrade-agent] ${packageName} is not a direct dependency of ${owner}/${repo}`
        );
      }

      if (fromVersion === toVersion) {
        console.log(`[upgrade-agent] ${packageName} is already at ${toVersion} — nothing to do`);
        return { status: "already-current" };
      }

      const target: UpgradeTarget = { packageName, fromVersion, toVersion };
      console.log(`[upgrade-agent] Upgrading ${packageName} ${fromVersion} → ${toVersion}`);

      // 2b. Analyse codebase usage
      const analysis = this.analysisLlm
        ? await this.analyseCodebase(workDir, target)
        : undefined;

      // 3. Research phase
      const heuristicRisk = deriveRiskLevel(fromVersion, toVersion);
      console.log(`[upgrade-agent] Heuristic risk: ${heuristicRisk}`);

      const plan = await this.research(target, repo, analysis, workDir);
      console.log(
        `[upgrade-agent] Research complete — risk: ${plan.riskLevel}, proceed: ${plan.shouldProceed}`
      );
      console.log(`[upgrade-agent] Summary: ${plan.researchSummary}`);
      if (plan.knownIssues.length > 0) {
        console.log(`[upgrade-agent] Known issues: ${plan.knownIssues.join("; ")}`);
      }
      console.log(`[upgrade-agent] ${plan.expectedBreakingChanges.length} expected breaking change(s)`);
      for (const bc of plan.expectedBreakingChanges) {
        console.log(`[upgrade-agent]   - ${bc.description}${bc.suggestedFix ? ` (fix: ${bc.suggestedFix})` : ""}`);
      }

      if (!plan.shouldProceed) {
        console.log(`[upgrade-agent] Research blocked upgrade — see plan for details`);
        return { status: "research-blocked", plan };
      }

      // 4. Create branch + bump
      const branch = `chore-bot/upgrade-${packageName.replace(/[^a-zA-Z0-9-]/g, "-")}-${toVersion}-${Date.now()}`;
      await this.git.createBranch(workDir, branch);
      await this.git.bumpPackageVersion(workDir, packageName, toVersion);
      console.log(`[upgrade-agent] Bumped ${packageName} to ${toVersion}`);

      // 5. Test-fix loop
      let iterations = 0;
      let lastResult = await this.git.runTests(workDir);

      while (!lastResult.passed && iterations < this.maxIterations) {
        console.log(`[upgrade-agent] Tests failing (iteration ${iterations + 1}/${this.maxIterations}) — asking LLM for fixes`);

        const affectedFiles = await this.getAffectedFiles(workDir, lastResult.output);
        const fix = await this.fixLlm.suggestFix({
          failureOutput: lastResult.output,
          plan,
          affectedFiles,
        });

        console.log(
          `[upgrade-agent] Fix suggestion: ${fix.patches.length} patch(es), confidence ${fix.confidence.toFixed(2)}`
        );

        for (const patch of fix.patches) {
          await this.git.writeFile(workDir, patch.filePath, patch.newContent);
          console.log(`[upgrade-agent] Patched ${patch.filePath}`);
        }

        if (fix.giveUp) {
          console.log(`[upgrade-agent] LLM gave up — remaining failures require manual fixes`);
          break;
        }

        lastResult = await this.git.runTests(workDir);
        iterations++;
      }

      if (lastResult.passed) {
        console.log(`[upgrade-agent] Tests passing after ${iterations} iteration(s)`);
      } else {
        console.warn(
          `[upgrade-agent] Tests still failing after ${iterations} iteration(s) — opening PR anyway`
        );
      }

      // 6. Commit + push + open PR
      const commitMsg = `chore(deps): upgrade ${packageName} ${fromVersion} → ${toVersion}`;
      await this.git.commitAndPush(workDir, branch, commitMsg);

      const result: UpgradeResult = {
        status: lastResult.passed ? "pr-created" : "fix-loop-exhausted",
        iterationsUsed: iterations,
        testsPassingOnOpen: lastResult.passed,
        plan,
      };

      const pr = await this.github.createPullRequest(owner, repo, {
        title: `chore(deps): upgrade ${packageName} ${fromVersion} → ${toVersion}`,
        body: formatPrBody(plan, result),
        head: branch,
        base,
      });

      console.log(`[upgrade-agent] Opened PR #${pr.number}: ${pr.url}`);

      await this.conductor.emit({
        type: "upgrade.completed",
        payload: { owner, repo, prNumber: pr.number, packageName, fromVersion, toVersion },
        timestamp: new Date(),
        correlationId: `${owner}/${repo}:upgrade-${packageName}-${pr.number}`,
      });

      return { ...result, prNumber: pr.number, prUrl: pr.url };
    } finally {
      await this.cleanup(tempParent);
    }
  }

  // --- Research phase ---

  private async research(target: UpgradeTarget, repo: string, codebaseAnalysis?: CodebaseAnalysis, workDir?: string): Promise<UpgradePlan> {
    // Resolve upstream repo for changelog + issue search
    const ownerRepo = resolveKnownRepo(target.packageName)
      ?? await resolveRepoFromNpm(target.packageName);

    // Run changelog, lessons, and issue search in parallel
    const [pastLessons, changelog, githubIssues] = await Promise.all([
      this.loadLessons(target.packageName, repo),
      ownerRepo
        ? this.github.getReleaseNotes(ownerRepo.owner, ownerRepo.repo, target.fromVersion, target.toVersion).catch(() => "")
        : Promise.resolve(""),
      ownerRepo
        ? this.github.searchIssues(
            ownerRepo.owner,
            ownerRepo.repo,
            `"${target.toVersion}" OR "upgrade" OR "migration" OR "breaking"`
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    if (changelog) {
      console.log(`[upgrade-agent] Fetched release notes for ${target.packageName} (${changelog.length} chars)`);
    }
    if (githubIssues.length > 0) {
      console.log(`[upgrade-agent] Found ${githubIssues.length} GitHub issue(s) for ${target.packageName}`);
    }

    const research: RawResearch = {
      changelog,
      pastLessons,
      codebaseAnalysis,
      githubIssues,
    };

    const toolExecutor = workDir
      ? createResearcherToolExecutor(workDir, this.git)
      : undefined;

    return this.researchLlm.synthesise(target, research, toolExecutor);
  }

  // --- Codebase analysis ---

  private async analyseCodebase(workDir: string, target: UpgradeTarget): Promise<CodebaseAnalysis> {
    const sourceFiles = await this.git.listSourceFiles(workDir);
    const usageSites: UsageSite[] = [];
    let matchedFiles = 0;

    for (const filePath of sourceFiles) {
      if (matchedFiles >= 25) break;

      let content: string;
      try {
        content = await this.git.readFile(workDir, filePath);
      } catch {
        continue;
      }

      if (!content.includes(target.packageName)) continue;
      matchedFiles++;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length && usageSites.length < 15; i++) {
        if (lines[i].includes(target.packageName)) {
          const start = Math.max(0, i - 10);
          const end = Math.min(lines.length, i + 10);
          usageSites.push({
            filePath,
            snippet: lines.slice(start, end).join("\n"),
          });
        }
      }
    }

    console.log(
      `[upgrade-agent] Codebase analysis: ${matchedFiles} file(s), ${usageSites.length} usage site(s) for ${target.packageName}`
    );

    const analysis = await this.analysisLlm!.analyse(target, usageSites);

    console.log(`[upgrade-agent] Analysis: wrapped=${analysis.isWrapped}, riskyPatterns=${analysis.riskyPatterns.length}`);
    console.log(`[upgrade-agent] Usage summary: ${analysis.usageSummary}`);

    return analysis;
  }

  // --- Auto-discovery ---

  private async discoverTarget(workDir: string): Promise<{ packageName: string; toVersion: string } | null> {
    if (!this.discovery) {
      throw new Error(
        "[upgrade-agent] packageName/toVersion not provided and no discovery LLM configured"
      );
    }

    // Aggregate deps across all package.json files (handles monorepos)
    const allDeps = await this.git.getAllDependencies(workDir);
    const names = Object.keys(allDeps).slice(0, 20); // cap to avoid too many registry calls
    console.log(`[upgrade-agent] Checking ${names.length} dependencies for updates`);

    // Fetch latest versions in parallel
    const candidates = (
      await Promise.all(
        names.map(async (name): Promise<UpgradeCandidate | null> => {
          const current = allDeps[name] ?? "";
          const latest = await getLatestNpmVersion(name);
          if (!latest) return null;

          if (current === latest) return null;

          const riskLevel = deriveRiskLevel(current, latest);
          return { packageName: name, currentVersion: current, latestVersion: latest, riskLevel };
        })
      )
    ).filter((c): c is UpgradeCandidate => c !== null);

    console.log(`[upgrade-agent] Found ${candidates.length} outdated package(s)`);
    if (candidates.length === 0) return null;

    const selected = await this.discovery.selectTarget(candidates);
    if (!selected) {
      console.log("[upgrade-agent] Discovery LLM declined all candidates");
      return null;
    }

    console.log(
      `[upgrade-agent] Auto-selected: ${selected.packageName} ${selected.currentVersion} → ${selected.latestVersion}`
    );
    return { packageName: selected.packageName, toVersion: selected.latestVersion };
  }

  private async loadLessons(packageName: string, repo: string): Promise<Lesson[]> {
    if (!this.memory) return [];

    const [repoDocs, globalDocs] = await Promise.all([
      this.memory.list({ filter: { agent: "upgrade", repo, type: "lesson" } }),
      this.memory.list({ filter: { agent: "upgrade", scope: "global", type: "lesson" } }),
    ]);

    console.log(`[upgrade-agent] Loaded ${repoDocs.length + globalDocs.length} lesson(s) from memory`);
    return [...repoDocs, ...globalDocs].map(docToLesson);
  }

  // --- Fix loop helpers ---

  private async getAffectedFiles(
    workDir: string,
    failureOutput: string
  ): Promise<Array<{ path: string; content: string }>> {
    const filePaths = extractFilePathsFromOutput(failureOutput);
    const results: Array<{ path: string; content: string }> = [];

    for (const filePath of filePaths.slice(0, 10)) { // cap context size
      try {
        const content = await this.git.readFile(workDir, filePath);
        results.push({ path: filePath, content });
      } catch {
        // file may not exist or path parsing was wrong — skip
      }
    }

    return results;
  }

  // --- Utilities ---

  private async makeTempDir(owner: string, repo: string): Promise<string> {
    const base = path.join(os.tmpdir(), `upgrade-agent-${owner}-${repo}-${Date.now()}`);
    await fs.mkdir(base, { recursive: true });
    return base;
  }

  private async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * Extracts source file paths from test failure output.
 * Matches common patterns: "src/foo.ts:42:5", "at src/foo.ts:42"
 */
function extractFilePathsFromOutput(output: string): string[] {
  const matches = output.matchAll(/(?:^|\s)((?:(?:packages|agents|apps)\/[^\s:()]+\/)?(?:src|lib|app|test|tests)\/[^\s:()]+\.(?:ts|tsx|js|jsx))/gm);
  return [...new Set([...matches].map((m) => m[1]))];
}

async function getLatestNpmVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`);
    if (!res.ok) return null;
    const data = await res.json() as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

interface OwnerRepo { owner: string; repo: string }

/**
 * Returns the GitHub owner/repo for packages in the hardcoded map.
 * Keeps KNOWN_REPOS as the fast path — no network call required.
 */
function resolveKnownRepo(packageName: string): OwnerRepo | null {
  const url = buildChangelogUrl(packageName);
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Falls back to the npm registry to discover the GitHub repo for any public package.
 * Parses the `repository.url` field (e.g. "git+https://github.com/owner/repo.git").
 */
async function resolveRepoFromNpm(packageName: string): Promise<OwnerRepo | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
    if (!res.ok) return null;
    const data = await res.json() as { repository?: { url?: string } };
    const url = data.repository?.url ?? "";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function docToLesson(doc: MemoryDocument): Lesson {
  const extract = (field: string) =>
    doc.content.match(new RegExp(`${field}: (.+)`))?.[1]?.trim() ?? "";
  return {
    problem: extract("Problem"),
    solution: extract("Solution"),
    context: extract("Context"),
    outcome: extract("Outcome"),
    tags: [],
    metadata: doc.metadata,
  };
}
