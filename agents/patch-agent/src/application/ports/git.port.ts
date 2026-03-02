import type { PackageFix, CheckResult } from "../../domain/entities/patch-plan";

export type PackageManager = "bun" | "npm" | "yarn" | "pnpm";

export interface GitPort {
  /**
   * Clone a repo to a local directory.
   * @param repoUrl - HTTPS clone URL (token auth embedded)
   * @param destDir - absolute path to clone into
   */
  cloneRepo(repoUrl: string, destDir: string): Promise<void>;

  /** Create and check out a new branch from HEAD. */
  createBranch(workDir: string, branchName: string): Promise<void>;

  /**
   * Apply version bumps to package.json and run the package manager install
   * to update the lockfile.
   */
  applyPackageFixes(workDir: string, fixes: PackageFix[]): Promise<void>;

  /** Stage all changes, commit, and push the branch to origin. */
  commitAndPush(workDir: string, branch: string, message: string): Promise<void>;

  /** Detect which package manager the project uses. */
  detectPackageManager(workDir: string): Promise<PackageManager>;

  /**
   * Run the project's build and test scripts (if present) and return a result.
   * Never throws — failures are captured in the returned CheckResult.
   */
  runChecks(workDir: string): Promise<CheckResult>;
}
