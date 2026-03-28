import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  createResearcherToolExecutor,
  RESEARCHER_TOOLS,
} from "../../src/domain/tools/researcher-tools";
import type { UpgradeGitPort } from "../../src/application/ports/upgrade-git.port";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

let tempDir: string;

/** Create a temp repo directory with files. */
async function setupRepo(files: Record<string, string>): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "researcher-tools-test-"));
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(tempDir, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
  return tempDir;
}

function createMockGit(files: Record<string, string>): UpgradeGitPort {
  return {
    cloneRepo: mock(() => Promise.resolve()),
    createBranch: mock(() => Promise.resolve()),
    getInstalledVersion: mock(() => Promise.resolve(null)),
    bumpPackageVersion: mock(() => Promise.resolve()),
    runTests: mock(() => Promise.resolve({ passed: true, output: "", exitCode: 0 })),
    getAllDependencies: mock(() => Promise.resolve({})),
    readFile: mock((_workDir: string, filePath: string) => {
      const content = files[filePath];
      if (content === undefined) return Promise.reject(new Error("ENOENT"));
      return Promise.resolve(content);
    }),
    writeFile: mock(() => Promise.resolve()),
    listSourceFiles: mock(() => Promise.resolve(Object.keys(files))),
    commitAndPush: mock(() => Promise.resolve()),
  };
}

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("RESEARCHER_TOOLS definitions", () => {
  test("exports three tool definitions", () => {
    expect(RESEARCHER_TOOLS).toHaveLength(3);
    const names = RESEARCHER_TOOLS.map((t) => t.function.name);
    expect(names).toContain("read_file");
    expect(names).toContain("grep");
    expect(names).toContain("list_files");
  });

  test("all tools have type 'function'", () => {
    for (const tool of RESEARCHER_TOOLS) {
      expect(tool.type).toBe("function");
    }
  });
});

describe("read_file", () => {
  test("returns file content", async () => {
    const files = { "src/index.ts": "console.log('hello');" };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.read_file({ path: "src/index.ts" });
    expect(result).toBe("console.log('hello');");
  });

  test("returns error for missing file", async () => {
    const workDir = await setupRepo({});
    const executor = createResearcherToolExecutor(workDir, createMockGit({}));

    const result = await executor.read_file({ path: "missing.ts" });
    expect(result).toContain("Error: file not found");
  });

  test("truncates large files", async () => {
    const bigContent = "x".repeat(20_000);
    const files = { "big.ts": bigContent };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.read_file({ path: "big.ts" });
    expect(result.length).toBeLessThan(bigContent.length);
    expect(result).toContain("truncated at 15000 chars");
  });

  test("returns error when path is empty", async () => {
    const workDir = await setupRepo({});
    const executor = createResearcherToolExecutor(workDir, createMockGit({}));

    const result = await executor.read_file({});
    expect(result).toContain("Error: path is required");
  });
});

describe("list_files", () => {
  test("returns source and config files", async () => {
    const files = {
      "src/index.ts": "",
      "src/utils.ts": "",
      "package.json": "{}",
      "tsconfig.json": "{}",
    };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.list_files({});
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).toContain("package.json");
    expect(result).toContain("tsconfig.json");
  });

  test("excludes node_modules and dist", async () => {
    const files = {
      "src/index.ts": "",
      "node_modules/foo/index.js": "",
      "dist/bundle.js": "",
    };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.list_files({});
    expect(result).toContain("src/index.ts");
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain("dist");
  });

  test("filters by directory prefix", async () => {
    const files = {
      "src/index.ts": "",
      "src/utils.ts": "",
      "lib/helper.ts": "",
    };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.list_files({ directory: "src" });
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/utils.ts");
    expect(result).not.toContain("lib/helper.ts");
  });

  test("returns message when no files match", async () => {
    const workDir = await setupRepo({ "src/index.ts": "" });
    const executor = createResearcherToolExecutor(workDir, createMockGit({}));

    const result = await executor.list_files({ directory: "nonexistent" });
    expect(result).toContain("No files found");
  });
});

describe("grep", () => {
  test("finds matching lines with context", async () => {
    const files = {
      "src/server.ts": "import express from 'express';\nconst app = express();\napp.listen(3000);",
    };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.grep({ pattern: "express\\(\\)" });
    expect(result).toContain("src/server.ts");
    expect(result).toContain("express()");
  });

  test("searches config files too", async () => {
    const files = {
      "package.json": '{"dependencies": {"react": "^19.0.0"}}',
    };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.grep({ pattern: "react" });
    expect(result).toContain("package.json");
    expect(result).toContain("react");
  });

  test("returns no matches message when nothing found", async () => {
    const files = { "src/index.ts": "console.log('hello');" };
    const workDir = await setupRepo(files);
    const executor = createResearcherToolExecutor(workDir, createMockGit(files));

    const result = await executor.grep({ pattern: "nonexistent_function" });
    expect(result).toBe("No matches found.");
  });

  test("returns error for invalid regex", async () => {
    const workDir = await setupRepo({ "src/index.ts": "hello" });
    const executor = createResearcherToolExecutor(workDir, createMockGit({}));

    const result = await executor.grep({ pattern: "[invalid" });
    expect(result).toContain("Error: invalid regex pattern");
  });

  test("returns error when pattern is empty", async () => {
    const workDir = await setupRepo({});
    const executor = createResearcherToolExecutor(workDir, createMockGit({}));

    const result = await executor.grep({});
    expect(result).toContain("Error: pattern is required");
  });
});
