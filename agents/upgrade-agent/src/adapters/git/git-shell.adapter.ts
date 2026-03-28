import { readFileSync, writeFileSync, existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { UpgradeGitPort, TestResult } from "../../application/ports/upgrade-git.port";

export class GitShellAdapter implements UpgradeGitPort {
  async cloneRepo(repoUrl: string, destDir: string): Promise<void> {
    await this.run(["git", "clone", "--depth=1", repoUrl, destDir], process.cwd());
  }

  async createBranch(workDir: string, branchName: string): Promise<void> {
    await this.run(["git", "checkout", "-b", branchName], workDir);
  }

  async getInstalledVersion(workDir: string, packageName: string): Promise<string | null> {
    // Search all package.json files in the workspace for the package
    const glob = new Bun.Glob("**/package.json");
    for (const rel of glob.scanSync({ cwd: workDir })) {
      if (rel.includes("node_modules")) continue;
      try {
        const raw = readFileSync(join(workDir, rel), "utf-8");
        const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const version =
          pkg.dependencies?.[packageName] ?? pkg.devDependencies?.[packageName];
        if (version) {
          // Strip semver range prefix (^, ~, >=, etc.)
          return version.replace(/^[^0-9]*/, "");
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async bumpPackageVersion(workDir: string, packageName: string, toVersion: string): Promise<void> {
    // Update all package.json files in the workspace that declare the package
    const glob = new Bun.Glob("**/package.json");
    for (const rel of glob.scanSync({ cwd: workDir })) {
      if (rel.includes("node_modules")) continue;
      const abs = join(workDir, rel);
      try {
        const raw = readFileSync(abs, "utf-8");
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        let changed = false;
        if (pkg.dependencies?.[packageName]) {
          pkg.dependencies[packageName] = toVersion;
          changed = true;
        }
        if (pkg.devDependencies?.[packageName]) {
          pkg.devDependencies[packageName] = toVersion;
          changed = true;
        }
        if (changed) {
          writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n");
          console.log(`[git-shell] Updated ${packageName} to ${toVersion} in ${rel}`);
        }
      } catch {
        continue;
      }
    }

    // Regenerate lockfile
    const pm = await this.detectPackageManager(workDir);
    const installCmd = { bun: ["bun", "install"], npm: ["npm", "install"], yarn: ["yarn", "install"], pnpm: ["pnpm", "install"] }[pm];
    await this.run(installCmd, workDir);
  }

  async runTests(workDir: string): Promise<TestResult> {
    const pm = await this.detectPackageManager(workDir);
    const cmd = pm === "bun" ? ["bun", "test"] : ["npm", "test", "--", "--passWithNoTests"];

    const proc = Bun.spawn(cmd, {
      cwd: workDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    return {
      passed: proc.exitCode === 0,
      output: [stdout, stderr].filter(Boolean).join("\n"),
      exitCode: proc.exitCode ?? 1,
    };
  }

  async getAllDependencies(workDir: string): Promise<Record<string, string>> {
    const glob = new Bun.Glob("**/package.json");
    const deps: Record<string, string> = {};
    for (const rel of glob.scanSync({ cwd: workDir })) {
      if (rel.includes("node_modules")) continue;
      try {
        const raw = readFileSync(join(workDir, rel), "utf-8");
        const pkg = JSON.parse(raw) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
          if (!(name in deps)) deps[name] = version.replace(/^[^0-9]*/, "");
        }
        for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
          if (!(name in deps)) deps[name] = version.replace(/^[^0-9]*/, "");
        }
      } catch {
        continue;
      }
    }
    return deps;
  }

  async readFile(workDir: string, filePath: string): Promise<string> {
    return readFile(join(workDir, filePath), "utf-8");
  }

  async writeFile(workDir: string, filePath: string, content: string): Promise<void> {
    return writeFile(join(workDir, filePath), content, "utf-8");
  }

  async listSourceFiles(workDir: string): Promise<string[]> {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
    const files: string[] = [];
    for (const rel of glob.scanSync({ cwd: workDir })) {
      if (rel.includes("node_modules") || rel.includes("dist") || rel.includes(".next")) continue;
      files.push(rel);
    }
    return files;
  }

  async commitAndPush(workDir: string, branch: string, message: string): Promise<void> {
    await this.run(["git", "add", "-A"], workDir);
    await this.run(["git", "commit", "-m", message], workDir);
    await this.run(["git", "push", "-u", "origin", branch], workDir);
  }

  private async detectPackageManager(workDir: string): Promise<"bun" | "npm" | "yarn" | "pnpm"> {
    if (existsSync(join(workDir, "bun.lock"))) return "bun";
    if (existsSync(join(workDir, "yarn.lock"))) return "yarn";
    if (existsSync(join(workDir, "pnpm-lock.yaml"))) return "pnpm";
    return "npm";
  }

  private async run(cmd: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr.trim()}`);
    }
  }
}
