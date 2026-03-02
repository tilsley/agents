import type { SnykPort } from "../../application/ports/snyk.port";
import type {
  VulnerabilityReport,
  Vulnerability,
  VulnerabilitySeverity,
} from "../../domain/entities/vulnerability";
import * as fs from "fs/promises";
import * as path from "path";

const SNYK_API = "https://snyk.io/api/v1";

const VALID_SEVERITIES = new Set<VulnerabilitySeverity>([
  "critical",
  "high",
  "medium",
  "low",
]);

/**
 * Calls the Snyk v1 REST API directly — no CLI required.
 *
 * POST /test/npm with the project's package.json (+ lockfile if present).
 * Token is the only credential needed (https://app.snyk.io/account).
 */
export class SnykApiAdapter implements SnykPort {
  constructor(private token: string) {}

  async scan(workDir: string): Promise<VulnerabilityReport> {
    const pkgDir = await this.findPackageDir(workDir);
    const pkgJson = await this.readFile(path.join(pkgDir, "package.json"));
    if (!pkgJson) {
      throw new Error(`[snyk-api] No package.json found in ${workDir} or its subdirectories`);
    }

    if (pkgDir !== workDir) {
      console.log(`[snyk-api] Found package.json in subdirectory: ${pkgDir}`);
    }

    // Include the lockfile for more accurate dep resolution
    const lockfile =
      (await this.readFile(path.join(pkgDir, "package-lock.json"))) ??
      (await this.readFile(path.join(pkgDir, "yarn.lock"))) ??
      (await this.readFile(path.join(pkgDir, "bun.lock")));

    const body: Record<string, unknown> = {
      files: {
        target: { contents: this.toBase64(pkgJson) },
        ...(lockfile
          ? { additional: [{ contents: this.toBase64(lockfile) }] }
          : {}),
      },
    };

    const response = await fetch(`${SNYK_API}/test/npm`, {
      method: "POST",
      headers: {
        Authorization: `token ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // Snyk returns 200 even when vulnerabilities are found;
    // non-200 means an API/auth error
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `[snyk-api] API error ${response.status}: ${text}`
      );
    }

    const data = (await response.json()) as SnykApiResponse;
    return this.mapResponse(data, pkgDir);
  }

  /** Find the directory containing package.json — root first, then one level deep. */
  private async findPackageDir(workDir: string): Promise<string> {
    // 1. Root
    if (await this.readFile(path.join(workDir, "package.json")) !== null) {
      return workDir;
    }

    // 2. Immediate subdirectories (sorted for determinism)
    let entries: string[] = [];
    try {
      entries = (await fs.readdir(workDir)).sort();
    } catch {
      return workDir;
    }

    for (const entry of entries) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const sub = path.join(workDir, entry);
      try {
        const stat = await fs.stat(sub);
        if (stat.isDirectory() && await this.readFile(path.join(sub, "package.json")) !== null) {
          return sub;
        }
      } catch {
        // Skip unreadable entries
      }
    }

    return workDir;
  }

  private mapResponse(data: SnykApiResponse, packageDir: string): VulnerabilityReport {
    const raw = data.issues?.vulnerabilities ?? [];
    const seen = new Set<string>();
    const vulnerabilities: Vulnerability[] = [];

    for (const v of raw) {
      // API uses "package" not "packageName"
      const packageName = v.package ?? v.packageName ?? "unknown";
      const key = `${v.id}::${packageName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const severity = VALID_SEVERITIES.has(v.severity as VulnerabilitySeverity)
        ? (v.severity as VulnerabilitySeverity)
        : "low";

      vulnerabilities.push({
        id: v.id ?? "unknown",
        title: v.title ?? "Unknown vulnerability",
        severity,
        packageName,
        installedVersion: v.version ?? "0.0.0",
        fixedIn: v.fixedIn ?? [],
        cves: v.identifiers?.CVE ?? [],
        isUpgradable: v.isUpgradable ?? false,
        upgradePath: v.upgradePath ?? [],
      });
    }

    return {
      vulnerabilities,
      packageManager: data.packageManager ?? "npm",
      projectName: data.projectName ?? path.basename(packageDir),
      ok: data.ok ?? vulnerabilities.length === 0,
      packageDir,
    };
  }

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  private toBase64(content: string): string {
    return Buffer.from(content).toString("base64");
  }
}

// Snyk v1 API response shapes (partial)
interface SnykApiResponse {
  ok?: boolean;
  packageManager?: string;
  projectName?: string;
  issues?: {
    vulnerabilities?: RawApiVuln[];
  };
}

interface RawApiVuln {
  id?: string;
  title?: string;
  severity?: string;
  package?: string;      // API uses "package"
  packageName?: string;  // CLI uses "packageName" — handle both
  version?: string;
  fixedIn?: string[];
  identifiers?: { CVE?: string[] };
  isUpgradable?: boolean;
  upgradePath?: Array<string | false>;
}
