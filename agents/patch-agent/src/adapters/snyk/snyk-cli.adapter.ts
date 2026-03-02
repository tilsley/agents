import { existsSync } from "fs";
import { join } from "path";
import type { SnykPort } from "../../application/ports/snyk.port";
import type {
  VulnerabilityReport,
  Vulnerability,
  VulnerabilitySeverity,
} from "../../domain/entities/vulnerability";

const VALID_SEVERITIES = new Set<VulnerabilitySeverity>([
  "critical",
  "high",
  "medium",
  "low",
]);

export class SnykCliAdapter implements SnykPort {
  constructor(private snykToken?: string) {}

  async scan(workDir: string): Promise<VulnerabilityReport> {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (this.snykToken) {
      env["SNYK_TOKEN"] = this.snykToken;
    }

    await this.generateLockfileIfNeeded(workDir);

    const proc = Bun.spawn(["snyk", "test", "--json", "--all-projects"], {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    // snyk exit codes:
    //   0 = no vulnerabilities
    //   1 = vulnerabilities found (valid JSON with vulnerabilities array)
    //   2 = scan error (no lockfile, unsupported project, auth failure, etc.)
    if (!stdout.trim()) {
      throw new Error(`[snyk-cli] No output from snyk (exit ${proc.exitCode}). stderr: ${stderr}`);
    }

    // exit 0 = clean, exit 1 = vulnerabilities found — both produce a valid vulnerabilities array
    // exit 2 = scan error (auth failure, network, etc.)
    // exit 3 = no supported target files (unsupported lockfile, missing node_modules, etc.)
    if (proc.exitCode !== 0 && proc.exitCode !== 1) {
      const errMsg = this.extractSnykError(stdout) ?? stderr.trim() ?? `exit code ${proc.exitCode}`;
      throw new Error(`[snyk-cli] Snyk scan failed: ${errMsg}`);
    }

    const report = this.parseSnykOutput(stdout);
    return { ...report, packageDir: workDir };
  }

  /**
   * Snyk requires a recognised lockfile. If the repo uses bun.lock but has no
   * package-lock.json, generate one with `npm install --package-lock-only` so
   * Snyk can resolve the dependency tree. The temp workDir is discarded after
   * the scan, so this has no effect on the real repo.
   */
  private async generateLockfileIfNeeded(workDir: string): Promise<void> {
    const hasBunLock = existsSync(join(workDir, "bun.lock"));
    const hasNpmLock = existsSync(join(workDir, "package-lock.json"));
    const hasYarnLock = existsSync(join(workDir, "yarn.lock"));
    const hasPnpmLock = existsSync(join(workDir, "pnpm-lock.yaml"));

    console.log(`[snyk-cli] lockfiles: bun.lock=${hasBunLock} package-lock.json=${hasNpmLock} yarn.lock=${hasYarnLock} pnpm-lock.yaml=${hasPnpmLock}`);

    if (!hasBunLock || hasNpmLock || hasYarnLock || hasPnpmLock) return;

    console.log("[snyk-cli] bun.lock detected — generating package-lock.json for Snyk compatibility");

    const proc = Bun.spawn(
      ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit"],
      { cwd: workDir, stdout: "pipe", stderr: "pipe" }
    );

    await proc.exited;

    if (!existsSync(join(workDir, "package-lock.json"))) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`[snyk-cli] Failed to generate package-lock.json: ${stderr.trim()}`);
    }

    console.log("[snyk-cli] package-lock.json generated");
  }

  private extractSnykError(stdout: string): string | null {
    try {
      const parsed = JSON.parse(stdout.trim()) as SnykOutput | SnykOutput[];
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      return first?.error ?? null;
    } catch {
      return null;
    }
  }

  private parseSnykOutput(raw: string): VulnerabilityReport {
    // snyk --all-projects may return an array of results (one per project)
    // or a single object. Normalise to a flat report.
    const parsed = JSON.parse(raw) as SnykOutput | SnykOutput[];

    if (Array.isArray(parsed)) {
      return this.mergeReports(parsed);
    }

    return this.mapReport(parsed);
  }

  private mergeReports(reports: SnykOutput[]): VulnerabilityReport {
    const vulns = reports.flatMap((r) => r.vulnerabilities ?? []);
    const first = reports[0] ?? {};
    return {
      vulnerabilities: this.mapVulnerabilities(vulns),
      packageManager: first.packageManager ?? "unknown",
      projectName: first.projectName ?? "unknown",
      ok: vulns.length === 0,
    };
  }

  private mapReport(report: SnykOutput): VulnerabilityReport {
    return {
      vulnerabilities: this.mapVulnerabilities(report.vulnerabilities ?? []),
      packageManager: report.packageManager ?? "unknown",
      projectName: report.projectName ?? "unknown",
      ok: report.ok ?? (report.vulnerabilities?.length === 0),
    };
  }

  private mapVulnerabilities(raw: RawVuln[]): Vulnerability[] {
    // Deduplicate by vuln id + packageName (snyk lists a vuln once per affected path)
    const seen = new Set<string>();
    const result: Vulnerability[] = [];

    for (const v of raw) {
      const key = `${v.id}::${v.packageName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const severity = VALID_SEVERITIES.has(v.severity as VulnerabilitySeverity)
        ? (v.severity as VulnerabilitySeverity)
        : "low";

      result.push({
        id: v.id ?? "unknown",
        title: v.title ?? "Unknown vulnerability",
        severity,
        packageName: v.packageName ?? "unknown",
        installedVersion: v.version ?? "0.0.0",
        fixedIn: v.fixedIn ?? [],
        cves: v.identifiers?.CVE ?? [],
        isUpgradable: v.isUpgradable ?? false,
        upgradePath: v.upgradePath ?? [],
      });
    }

    return result;
  }
}

// Raw Snyk JSON shapes (partial — only the fields we use)
interface RawVuln {
  id?: string;
  title?: string;
  severity?: string;
  packageName?: string;
  version?: string;
  fixedIn?: string[];
  identifiers?: { CVE?: string[] };
  isUpgradable?: boolean;
  upgradePath?: Array<string | false>;
}

interface SnykOutput {
  ok?: boolean;
  error?: string;
  vulnerabilities?: RawVuln[];
  packageManager?: string;
  projectName?: string;
}
