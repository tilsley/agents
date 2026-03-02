import type { GitPort, PackageManager } from "../../application/ports/git.port";
import type { PackageFix, CheckResult } from "../../domain/entities/patch-plan";
import * as fs from "fs/promises";
import * as path from "path";

export class GitShellAdapter implements GitPort {
  constructor(
    private gitAuthorName = "chore-bot",
    private gitAuthorEmail = "chore-bot@users.noreply.github.com"
  ) {}

  async cloneRepo(repoUrl: string, destDir: string): Promise<void> {
    // Depth 1 — we only need the latest commit to create a patch branch
    await this.run(["git", "clone", "--depth=1", repoUrl, destDir], process.cwd());
  }

  async createBranch(workDir: string, branchName: string): Promise<void> {
    await this.run(["git", "checkout", "-b", branchName], workDir);
  }

  async applyPackageFixes(workDir: string, fixes: PackageFix[]): Promise<void> {
    // 1. Read and update package.json
    const pkgPath = path.join(workDir, "package.json");
    const raw = await fs.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as PackageJson;

    for (const fix of fixes) {
      this.bumpVersion(pkg, fix.packageName, fix.toVersion);
    }

    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");

    // 2. Run install to update the lockfile
    const pm = await this.detectPackageManager(workDir);
    const installCmd = INSTALL_COMMANDS[pm];
    await this.run(installCmd, workDir);
  }

  async commitAndPush(workDir: string, branch: string, message: string): Promise<void> {
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: this.gitAuthorName,
      GIT_AUTHOR_EMAIL: this.gitAuthorEmail,
      GIT_COMMITTER_NAME: this.gitAuthorName,
      GIT_COMMITTER_EMAIL: this.gitAuthorEmail,
    };

    await this.run(["git", "add", "-A"], workDir, env);
    await this.run(["git", "commit", "-m", message], workDir, env);
    await this.run(["git", "push", "origin", branch], workDir, env);
  }

  async runChecks(workDir: string): Promise<CheckResult> {
    const pm = await this.detectPackageManager(workDir);
    const runner = pm === "bun" ? "bun" : pm === "yarn" ? "yarn" : pm === "pnpm" ? "pnpm" : "npm";

    // Read available scripts from package.json
    let scripts: Record<string, string> = {};
    try {
      const raw = await fs.readFile(path.join(workDir, "package.json"), "utf-8");
      scripts = (JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      return { success: true, step: "none", output: "" };
    }

    // CI=true: makes CRA and most frameworks run non-interactively
    const env = { ...process.env, CI: "true" } as Record<string, string>;

    if (scripts["build"]) {
      const build = await this.runSafe([runner, "run", "build"], workDir, env, 3 * 60_000);
      if (!build.success) {
        return { success: false, step: "build", output: build.output };
      }
    }

    if (scripts["test"]) {
      const test = await this.runSafe([runner, "run", "test"], workDir, env, 5 * 60_000);
      if (!test.success) {
        return { success: false, step: "test", output: test.output };
      }
      return { success: true, step: "test", output: test.output };
    }

    return { success: true, step: scripts["build"] ? "build" : "none", output: "" };
  }

  async detectPackageManager(workDir: string): Promise<PackageManager> {
    const checks: Array<[string, PackageManager]> = [
      ["bun.lock", "bun"],
      ["bun.lockb", "bun"],
      ["pnpm-lock.yaml", "pnpm"],
      ["yarn.lock", "yarn"],
    ];

    for (const [lockfile, pm] of checks) {
      try {
        await fs.access(path.join(workDir, lockfile));
        return pm;
      } catch {
        // Not found — try next
      }
    }

    return "npm";
  }

  /** Update a package version in dependencies or devDependencies, preserving range prefix. */
  private bumpVersion(pkg: PackageJson, packageName: string, toVersion: string): void {
    for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const deps = pkg[section];
      if (!deps || !(packageName in deps)) continue;

      const current = deps[packageName];
      // Preserve range operator (^, ~, >=, etc.)
      const prefix = current.match(/^([~^>=<|* ]*)/)?.[1]?.trim() ?? "^";
      deps[packageName] = prefix ? `${prefix}${toVersion}` : toVersion;
      return;
    }

    // Not found in any section — nothing to do
    console.warn(`[git-shell] Package ${packageName} not found in package.json`);
  }

  private async run(
    args: string[],
    cwd: string,
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
  ): Promise<void> {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "inherit",
      stderr: "pipe",
      env: env as Record<string, string>,
    });

    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    if (code !== 0) {
      throw new Error(
        `[git-shell] Command failed (exit ${code}): ${args.join(" ")}\n${stderr}`
      );
    }
  }

  /** Like run() but captures output, never throws, and enforces a timeout. */
  private async runSafe(
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number
  ): Promise<{ success: boolean; output: string }> {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    clearTimeout(timer);

    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    // Truncate to avoid enormous PR bodies
    const output = timedOut
      ? `[timed out after ${timeoutMs / 1000}s]\n${combined.slice(-2000)}`
      : combined.slice(-3000);

    return { success: !timedOut && code === 0, output };
  }
}

const INSTALL_COMMANDS: Record<PackageManager, string[]> = {
  bun: ["bun", "install"],
  // --legacy-peer-deps: old repos with known vulns often have stale peer dep
  // declarations that cause ERESOLVE. This flag restores npm v6 behaviour and
  // is safe for lockfile-regeneration purposes.
  npm: ["npm", "install", "--legacy-peer-deps"],
  yarn: ["yarn", "install"],
  pnpm: ["pnpm", "install"],
};

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}
