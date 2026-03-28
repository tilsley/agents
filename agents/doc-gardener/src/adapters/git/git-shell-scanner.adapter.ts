import type { RepoScannerPort } from "../../application/ports/repo-scanner.port";
import * as fs from "fs/promises";
import * as path from "path";

export class GitShellScannerAdapter implements RepoScannerPort {
  constructor(
    private gitAuthorName = "doc-gardener-bot",
    private gitAuthorEmail = "doc-gardener-bot@users.noreply.github.com"
  ) {}

  async cloneRepo(repoUrl: string, destDir: string): Promise<void> {
    await this.run(["git", "clone", "--depth=1", repoUrl, destDir], process.cwd());
  }

  async listFiles(workDir: string): Promise<string[]> {
    const output = await this.capture(
      ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
      workDir
    );
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async readFile(workDir: string, filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(path.join(workDir, filePath), "utf-8");
    } catch {
      return null;
    }
  }

  async writeFile(workDir: string, filePath: string, content: string): Promise<void> {
    const fullPath = path.join(workDir, filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async createBranch(workDir: string, branchName: string): Promise<void> {
    await this.run(["git", "checkout", "-b", branchName], workDir);
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

  async getModifiedFiles(workDir: string): Promise<string[]> {
    // Modified/added existing tracked files
    const diffOutput = await this.capture(
      ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
      workDir
    ).catch(() => ""); // empty if no commits yet or clean

    // New untracked files created by the agent
    const untrackedOutput = await this.capture(
      ["git", "ls-files", "--others", "--exclude-standard"],
      workDir
    );

    const files = new Set<string>();
    for (const line of diffOutput.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
    for (const line of untrackedOutput.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }

    return [...files];
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
        `[git-shell-scanner] Command failed (exit ${code}): ${args.join(" ")}\n${stderr}`
      );
    }
  }

  private async capture(
    args: string[],
    cwd: string
  ): Promise<string> {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;

    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `[git-shell-scanner] Command failed (exit ${code}): ${args.join(" ")}\n${stderr}`
      );
    }

    return stdout;
  }
}
