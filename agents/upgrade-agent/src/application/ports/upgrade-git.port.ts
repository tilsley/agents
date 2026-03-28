export interface TestResult {
  passed: boolean;
  /** Combined stdout + stderr from the test run. */
  output: string;
  exitCode: number;
}

export interface UpgradeGitPort {
  /** Clone a repo to a local directory. Token auth embedded in URL. */
  cloneRepo(repoUrl: string, destDir: string): Promise<void>;

  /** Create and check out a new branch from HEAD. */
  createBranch(workDir: string, branchName: string): Promise<void>;

  /**
   * Read the installed version of a package from the workspace's package.json.
   * Returns null if the package is not a direct dependency.
   */
  getInstalledVersion(workDir: string, packageName: string): Promise<string | null>;

  /**
   * Bump a package to a specific version in package.json and regenerate the lockfile.
   * Uses the package manager detected in the repo (bun, npm, yarn, pnpm).
   */
  bumpPackageVersion(workDir: string, packageName: string, toVersion: string): Promise<void>;

  /** Run the project's test suite. Never throws — failures are captured in the result. */
  runTests(workDir: string): Promise<TestResult>;

  /**
   * Aggregate all direct dependencies declared across every package.json in the
   * repo (excluding node_modules). For monorepos this covers all workspace packages.
   * Returns a map of packageName → version string (range prefix stripped).
   */
  getAllDependencies(workDir: string): Promise<Record<string, string>>;

  /** Read a file from the working directory. */
  readFile(workDir: string, filePath: string): Promise<string>;

  /** Write (overwrite) a file in the working directory. */
  writeFile(workDir: string, filePath: string, content: string): Promise<void>;

  /**
   * List all TypeScript/JavaScript source files in the working directory.
   * Excludes node_modules, dist, and generated files.
   */
  listSourceFiles(workDir: string): Promise<string[]>;

  /** Stage all changes, commit, and push the branch to origin. */
  commitAndPush(workDir: string, branch: string, message: string): Promise<void>;
}
