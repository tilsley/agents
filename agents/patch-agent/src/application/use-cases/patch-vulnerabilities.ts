import type { GitHubPort, MemoryPort, MemoryDocument, Lesson } from "@tilsley/shared";
import type { SnykPort } from "../ports/snyk.port";
import type { GitPort } from "../ports/git.port";
import type { ConductorPort } from "../ports/conductor.port";
import type { PatchAdvisorLlmPort } from "../ports/patch-advisor-llm.port";
import type { PatchResult, PatchPlan } from "../../domain/entities/patch-plan";
import type { Vulnerability, VulnerabilitySeverity } from "../../domain/entities/vulnerability";
import {
  filterByMinSeverity,
  DEFAULT_MIN_SEVERITY,
  type VulnerabilitySeverity,
} from "../../domain/policies/severity-policy";
import { buildPatchPlan, buildPrTitle } from "../../domain/policies/grouping-policy";
import { formatPrBody, formatCommitMessage } from "../../domain/utils/format-pr-body";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

function logScanSummary(
  vulns: Vulnerability[],
  owner: string,
  minSeverity: VulnerabilitySeverity
): void {
  const SEVERITY_ORDER: VulnerabilitySeverity[] = ["critical", "high", "medium", "low"];

  // Counts per severity
  const counts = new Map<VulnerabilitySeverity, number>();
  for (const v of vulns) counts.set(v.severity, (counts.get(v.severity) ?? 0) + 1);

  const countStr = SEVERITY_ORDER.filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(", ");

  console.log(`[patch-agent] Snyk found ${vulns.length} vulnerabilities: ${countStr}`);

  // Group by package, keeping the highest severity per package
  const pkgMap = new Map<
    string,
    { severity: VulnerabilitySeverity; count: number; upgradable: boolean; toVersion?: string }
  >();
  for (const v of vulns) {
    const existing = pkgMap.get(v.packageName);
    const toVersion =
      v.isUpgradable && v.upgradePath.length >= 2
        ? (v.upgradePath[1] as string).split("@").at(-1)
        : undefined;

    if (!existing) {
      pkgMap.set(v.packageName, {
        severity: v.severity,
        count: 1,
        upgradable: v.isUpgradable,
        toVersion,
      });
    } else {
      existing.count++;
      // Escalate severity if higher
      const order: Record<VulnerabilitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      if ((order[v.severity] ?? 0) > (order[existing.severity] ?? 0)) {
        existing.severity = v.severity;
      }
      if (v.isUpgradable) {
        existing.upgradable = true;
        if (toVersion) existing.toVersion = toVersion;
      }
    }
  }

  for (const [pkg, info] of pkgMap) {
    const vulnLabel = info.count === 1 ? "1 vuln" : `${info.count} vulns`;
    const fixLabel = info.upgradable
      ? info.toVersion
        ? `→ ${info.toVersion}`
        : "upgradable"
      : "no fix available";
    const belowThreshold =
      (({ critical: 4, high: 3, medium: 2, low: 1 } as Record<VulnerabilitySeverity, number>)[info.severity] ?? 0) <
      (({ critical: 4, high: 3, medium: 2, low: 1 } as Record<VulnerabilitySeverity, number>)[minSeverity] ?? 0);
    const thresholdNote = belowThreshold ? ` [below ${minSeverity} threshold]` : "";

    console.log(
      `[patch-agent]   ${pkg.padEnd(40)} ${info.severity.padEnd(8)} ${vulnLabel.padEnd(10)} ${fixLabel}${thresholdNote}`
    );
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

export interface PatchVulnerabilitiesInput {
  owner: string;
  repo: string;
  /** GitHub token for clone auth and API calls */
  token: string;
  /** Target branch to open the PR against (default: main) */
  base?: string;
  /** Minimum severity to fix (default: high) */
  minSeverity?: VulnerabilitySeverity;
}

export class PatchVulnerabilities {
  constructor(
    private snyk: SnykPort,
    private git: GitPort,
    private github: GitHubPort,
    private conductor: ConductorPort,
    private memory?: MemoryPort,
    private advisor?: PatchAdvisorLlmPort
  ) {}

  async execute(input: PatchVulnerabilitiesInput): Promise<PatchResult> {
    const {
      owner,
      repo,
      token,
      base = "main",
      minSeverity = DEFAULT_MIN_SEVERITY,
    } = input;

    // Create a parent dir; git clone will create <parent>/<repo>/ itself.
    // Never pre-create workDir — git behaves more predictably cloning into a new path.
    const tempParent = await this.makeTempDir(owner, repo);
    const workDir = path.join(tempParent, repo);

    try {
      // 1. Clone
      const repoUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
      await this.git.cloneRepo(repoUrl, workDir);
      console.log(`[patch-agent] Cloned ${owner}/${repo} to ${workDir}`);

      // 2. Scan with Snyk
      const report = await this.snyk.scan(workDir);
      // Use the package dir the adapter resolved (may be a subdirectory)
      const packageDir = report.packageDir ?? workDir;

      if (report.ok) {
        console.log(`[patch-agent] ${owner}/${repo} is clean — no vulnerabilities`);
        return { status: "clean" };
      }

      // 2b. Log what Snyk found before any filtering
      logScanSummary(report.vulnerabilities, owner, minSeverity);

      // 3. Filter to actionable severity
      const fixable = filterByMinSeverity(
        report.vulnerabilities.filter((v) => v.isUpgradable),
        minSeverity
      );

      if (fixable.length === 0) {
        const upgradableCount = report.vulnerabilities.filter((v) => v.isUpgradable).length;
        if (upgradableCount === 0) {
          console.log(`[patch-agent] None of the vulnerabilities have an auto-fix path`);
        } else {
          console.log(
            `[patch-agent] ${upgradableCount} upgradable vuln(s) found but all are below ${minSeverity} threshold — nothing to apply`
          );
        }
        return { status: "no-fixable-vulns" };
      }

      console.log(
        `[patch-agent] Found ${fixable.length} fixable vulnerability/ies in ${owner}/${repo}`
      );

      // 4. Build patch plan (safety-policy filters out downgrades before we touch git)
      let plan = buildPatchPlan(fixable, owner, repo);

      if (plan.skipped.length > 0) {
        for (const s of plan.skipped) {
          console.warn(`[patch-agent] Skipped ${s.fix.packageName}: ${s.reason}`);
        }
      }

      if (plan.fixes.length === 0) {
        console.log(`[patch-agent] All candidate fixes were skipped by safety policy — nothing to apply`);
        return { status: "no-fixable-vulns" };
      }

      // 4b. Load lessons from memory and get LLM advice
      const advice = await this.getAdvice(plan, repo);

      // 4c. Apply LLM deferral — move any packagesToDefer out of fixes before touching git
      if (advice && advice.packagesToDefer.length > 0) {
        const deferred = new Set(advice.packagesToDefer);
        const deferredFixes = plan.fixes.filter((f) => deferred.has(f.packageName));
        const remainingFixes = plan.fixes.filter((f) => !deferred.has(f.packageName));

        if (deferredFixes.length > 0) {
          for (const f of deferredFixes) {
            console.warn(`[patch-agent] Deferred ${f.packageName} — LLM advisor flagged as too risky for auto-apply`);
          }
          plan = {
            ...plan,
            fixes: remainingFixes,
            prTitle: buildPrTitle(remainingFixes),
            skipped: [
              ...plan.skipped,
              ...deferredFixes.map((f) => ({
                fix: f,
                reason: `Deferred by LLM advisor: risk too high for auto-apply`,
              })),
            ],
          };
        }

        if (plan.fixes.length === 0) {
          console.log(`[patch-agent] All remaining fixes deferred by LLM advisor — nothing to apply`);
          return { status: "no-fixable-vulns" };
        }
      }

      const commitMsg = formatCommitMessage(plan);

      // 5. Create branch (git root, not package subdir)
      await this.git.createBranch(workDir, plan.branch);

      // 6. Apply version bumps + update lockfile (package subdir)
      await this.git.applyPackageFixes(packageDir, plan.fixes);

      // 7. Run build + tests to validate the bump doesn't break the app
      console.log(`[patch-agent] Running checks in ${packageDir}...`);
      const checks = await this.git.runChecks(packageDir);
      if (checks.success) {
        console.log(`[patch-agent] Checks passed (step: ${checks.step})`);
      } else {
        console.warn(`[patch-agent] Checks failed at step: ${checks.step} — PR will be flagged`);
      }

      // 8. Commit + push
      await this.git.commitAndPush(workDir, plan.branch, commitMsg);

      // 9. Open PR
      const pr = await this.github.createPullRequest(owner, repo, {
        title: plan.prTitle,
        body: formatPrBody(plan, owner, repo, checks, advice ?? undefined),
        head: plan.branch,
        base,
      });

      console.log(
        `[patch-agent] Opened PR #${pr.number}: ${plan.prTitle}`
      );

      // 10. Emit so the conductor pipeline picks up the PR
      await this.conductor.emit({
        type: "patch-agent.completed",
        payload: { owner, repo, prNumber: pr.number, planFixCount: plan.fixes.length },
        timestamp: new Date(),
        correlationId: `${owner}/${repo}:patch-${pr.number}`,
      });

      return { status: "pr-created", prNumber: pr.number, prUrl: pr.url, plan, checks };
    } finally {
      await this.cleanup(tempParent);
    }
  }

  private async getAdvice(plan: PatchPlan, repo: string) {
    if (!this.memory || !this.advisor) return null;

    const [repoDocs, globalDocs] = await Promise.all([
      this.memory.list({ filter: { agent: "security-patch", repo, type: "lesson" } }),
      this.memory.list({ filter: { agent: "security-patch", scope: "global", type: "lesson" } }),
    ]);

    const lessons = [...repoDocs, ...globalDocs].map(docToLesson);
    console.log(`[patch-agent] Loaded ${lessons.length} lesson(s) from memory`);

    const advice = await this.advisor.advise(plan, lessons);

    if (advice.riskLevel !== "low") {
      console.warn(`[patch-agent] Risk level: ${advice.riskLevel.toUpperCase()}`);
    }
    for (const w of advice.warnings) console.warn(`[patch-agent] ⚠️  ${w}`);
    for (const n of advice.migrationNotes) console.log(`[patch-agent] 📋 ${n}`);
    if (advice.scopingRecommendation) {
      console.log(`[patch-agent] 🔍 ${advice.scopingRecommendation}`);
    }

    return advice;
  }

  private async makeTempDir(owner: string, repo: string): Promise<string> {
    const base = path.join(os.tmpdir(), `patch-agent-${owner}-${repo}-${Date.now()}`);
    await fs.mkdir(base, { recursive: true });
    return base;
  }

  private async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
