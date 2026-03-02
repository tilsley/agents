import type { Vulnerability } from "../entities/vulnerability";
import type { PackageFix, PatchPlan } from "../entities/patch-plan";
import { getHighestSeverity } from "./severity-policy";
import { filterSafeUpgrades } from "./safety-policy";

/**
 * Groups upgradable vulnerabilities into one PackageFix per direct dependency.
 * Multiple CVEs in the same package collapse into a single version bump.
 *
 * Snyk upgradePath convention:
 *   upgradePath[1] = "packageName@targetVersion" (the direct dep to change)
 */
export function groupVulnerabilitiesByFix(vulns: Vulnerability[]): PackageFix[] {
  const fixMap = new Map<string, { toVersion: string; vulns: Vulnerability[] }>();

  for (const vuln of vulns) {
    if (!vuln.isUpgradable || vuln.upgradePath.length < 2) continue;

    const directFix = vuln.upgradePath[1];
    if (typeof directFix !== "string") continue;

    const atIdx = directFix.lastIndexOf("@");
    if (atIdx <= 0) continue;

    const packageName = directFix.slice(0, atIdx);
    const toVersion = directFix.slice(atIdx + 1);

    const existing = fixMap.get(packageName);
    if (existing) {
      existing.vulns.push(vuln);
      // Keep the higher target version
      if (compareVersions(toVersion, existing.toVersion) > 0) {
        existing.toVersion = toVersion;
      }
    } else {
      fixMap.set(packageName, { toVersion, vulns: [vuln] });
    }
  }

  return Array.from(fixMap.entries()).map(([packageName, { toVersion, vulns }]) => ({
    packageName,
    fromVersion: vulns[0].installedVersion,
    toVersion,
    vulnerabilities: vulns,
    highestSeverity: getHighestSeverity(vulns),
  }));
}

export function buildBranchName(fixes: PackageFix[], owner: string, repo: string): string {
  const timestamp = Date.now();
  if (fixes.length === 1) {
    const fix = fixes[0];
    // Safe branch name: no slashes or special chars in package name
    const safePkg = fix.packageName.replace(/[^a-zA-Z0-9-]/g, "-");
    return `chore-bot/patch-${safePkg}-${fix.toVersion}-${timestamp}`;
  }
  return `chore-bot/patch-vulns-${fixes.length}-packages-${timestamp}`;
}

export function buildPrTitle(fixes: PackageFix[]): string {
  if (fixes.length === 1) {
    const fix = fixes[0];
    const count = fix.vulnerabilities.length;
    const label = count === 1 ? "1 vuln" : `${count} vulns`;
    return `fix(deps): patch ${fix.packageName} ${fix.fromVersion} → ${fix.toVersion} (${label})`;
  }
  const totalVulns = fixes.reduce((sum, f) => sum + f.vulnerabilities.length, 0);
  return `fix(deps): patch ${fixes.length} packages (${totalVulns} vulns)`;
}

export function buildPatchPlan(
  vulns: Vulnerability[],
  owner: string,
  repo: string
): PatchPlan {
  const upgradable = vulns.filter((v) => v.isUpgradable);
  const unfixable = vulns.filter((v) => !v.isUpgradable);
  const allFixes = groupVulnerabilitiesByFix(upgradable);
  const { safe: fixes, skipped } = filterSafeUpgrades(allFixes);
  const branch = buildBranchName(fixes, owner, repo);
  const prTitle = buildPrTitle(fixes);

  return { fixes, skipped, unfixable, branch, prTitle };
}

/** Simple semver-ish comparison — handles x.y.z format. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
