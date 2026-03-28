import type { RepoScannerPort } from "../ports/repo-scanner.port";
import type { DocWriterLlmPort } from "../ports/doc-writer-llm.port";
import type { DocAnalyzerLlmPort } from "../ports/doc-analyzer-llm.port";
import type { CodeAnalyzerLlmPort, SourceFile } from "../ports/code-analyzer-llm.port";
import type { DocPlannerLlmPort } from "../ports/doc-planner-llm.port";
import type { SinglePassFixerLlmPort } from "../ports/single-pass-fixer-llm.port";
import type { AgentFixerLlmPort } from "../ports/agent-fixer-llm.port";
import type { GitHubPort, PolicyPort } from "@tilsley/shared";
import type { DriftItem } from "../../domain/entities/drift-report";
import type { DocUpdatePlan } from "../../domain/entities/doc-update-plan";
import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { GardenerResult } from "../../domain/entities/gardener-result";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";
import { detectAllDrift } from "../../domain/policies/drift-detection-policy";
import {
  selectFilesForAnalysis,
  enforceByteLimit,
} from "../../domain/policies/file-selection-policy";
import { formatPrBody } from "../../domain/utils/format-pr-body";
import { loadRepoTemplate } from "../../domain/utils/load-repo-template";
import { tmpdir } from "os";
import { join } from "path";

export interface ScanRepoDocsInput {
  owner: string;
  repo: string;
  token: string;
  base?: string;
  maxIterations?: number;
  strategy?: "agentic" | "single-pass" | "agent";
}

export interface AgenticPorts {
  docAnalyzer: DocAnalyzerLlmPort;
  codeAnalyzer: CodeAnalyzerLlmPort;
  planner: DocPlannerLlmPort;
  docWriter: DocWriterLlmPort;
}

export class ScanRepoDocs {
  constructor(
    private scanner: RepoScannerPort,
    private github: GitHubPort,
    private policyStore: PolicyPort,
    private agenticPorts?: AgenticPorts,
    private singlePassFixer?: SinglePassFixerLlmPort,
    private agentFixer?: AgentFixerLlmPort,
  ) {}

  async execute(input: ScanRepoDocsInput): Promise<GardenerResult> {
    const { owner, repo, token, base = "main", strategy = "agentic" } = input;
    const repoSlug = `${owner}/${repo}`;
    const workDir = join(tmpdir(), `doc-gardener-${repo}-${Date.now()}`);

    // --- Clone ---
    console.log(`[doc-gardener] Cloning ${repoSlug}...`);
    await this.scanner.cloneRepo(
      `https://x-access-token:${token}@github.com/${repoSlug}.git`,
      workDir
    );

    // --- Inventory extraction (deterministic) ---
    console.log(`[doc-gardener] Extracting inventory...`);
    const inventory = await this.extractInventory(workDir);

    // --- Load policy rules ---
    const policyRules = await this.policyStore.listRules({
      type: "documentation",
      active: true,
      repo: repoSlug,
    });
    console.log(`[doc-gardener] Loaded ${policyRules.length} policy rules`);

    // --- Agent strategy: LLM is the sole analyst, skip deterministic detection ---
    if (strategy === "agent") {
      const template = loadRepoTemplate("policies", repoSlug);
      if (template) {
        console.log(`[doc-gardener] Loaded repo template: ${template.name}`);
      }
      return this.executeAgent(input, workDir, repoSlug, inventory, policyRules, template);
    }

    // --- Deterministic drift detection (step 0 pre-filter for agentic/single-pass) ---
    const deterministicDrift = detectAllDrift(inventory, policyRules);
    console.log(
      `[doc-gardener] Deterministic drift: ${deterministicDrift.length} items`
    );
    for (const item of deterministicDrift) {
      console.log(`  [${item.severity}] ${item.driftType}: ${item.detail}`);
    }

    if (strategy === "single-pass") {
      return this.executeSinglePass(input, workDir, repoSlug, inventory, deterministicDrift, policyRules);
    }

    return this.executeAgentic(input, workDir, repoSlug, inventory, deterministicDrift, policyRules);
  }

  // ---------------------------------------------------------------------------
  // Single-pass strategy: 1 LLM call
  // ---------------------------------------------------------------------------

  private async executeSinglePass(
    input: ScanRepoDocsInput,
    workDir: string,
    repoSlug: string,
    inventory: RepoInventory,
    deterministicDrift: DriftItem[],
    policyRules: import("@tilsley/shared").PolicyRule[],
  ): Promise<GardenerResult> {
    if (!this.singlePassFixer) {
      throw new Error("single-pass strategy requires a SinglePassFixerLlmPort");
    }

    const { owner, repo, token, base = "main" } = input;
    const currentDoc = inventory.readmeContent ?? null;

    // Select and load source files (same heuristic as agentic mode, but no claims to guide selection)
    const selectedPaths = selectFilesForAnalysis(inventory.allFiles, []);
    const sourceFiles = await this.loadSourceFiles(workDir, selectedPaths);
    console.log(`[doc-gardener] Loaded ${sourceFiles.length} source files for single-pass analysis`);

    // --- Single LLM call ---
    console.log(`[doc-gardener] Running single-pass fixer (1 LLM call)...`);
    const result = await this.singlePassFixer.fix({
      inventory,
      sourceFiles,
      deterministicDrift,
      policyRules,
      currentDoc,
      repo: repoSlug,
    });

    console.log(
      `[doc-gardener] Single-pass result: ${result.driftItems.length} drift items, ${result.files.length} files`
    );

    if (result.files.length === 0) {
      console.log(`[doc-gardener] No files produced — repo is clean or fixer found nothing to fix`);
      return {
        status: deterministicDrift.length === 0 ? "clean" : "gave-up",
        driftItems: result.driftItems,
        iterationsUsed: 0,
        remainingGaps: 0,
      };
    }

    // Check if any file actually changed
    const hasChanges = result.files.some((f) => {
      if (f.file === "README.md") return f.content !== (currentDoc ?? "");
      return true;
    });

    if (!hasChanges) {
      console.log(`[doc-gardener] No changes produced`);
      return {
        status: "clean",
        driftItems: result.driftItems,
        iterationsUsed: 0,
        remainingGaps: 0,
      };
    }

    // --- Build a minimal DocUpdatePlan for the PR body ---
    const plan: DocUpdatePlan = {
      repo: repoSlug,
      driftItems: result.driftItems,
      policyRules,
      fixes: result.driftItems.map((d, i) => ({
        drift: d,
        action: "update-claim" as const,
        file: d.file,
        section: d.section,
        description: d.detail,
        priority: i + 1,
      })),
      giveUp: false,
      planReasoning: result.planReasoning,
    };

    // --- Write files, commit, push, open PR ---
    const branch = `doc-gardener/update-docs-${Date.now()}`;
    await this.scanner.createBranch(workDir, branch);

    for (const f of result.files) {
      console.log(`[doc-gardener] Writing ${f.file}`);
      await this.scanner.writeFile(workDir, f.file, f.content);
    }

    await this.scanner.commitAndPush(
      workDir,
      branch,
      "docs: update documentation to match codebase"
    );

    const prBody = formatPrBody(plan, 0, 0);
    const pr = await this.github.createPullRequest(owner, repo, {
      title: "docs: fix documentation drift",
      body: prBody,
      head: branch,
      base,
    });

    console.log(`[doc-gardener] PR opened: ${pr.url} (status: pr-opened)`);
    return {
      status: "pr-opened",
      driftItems: result.driftItems,
      plan,
      iterationsUsed: 0,
      remainingGaps: 0,
      prUrl: pr.url,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent strategy: SDK built-in tools (1 premium request)
  // ---------------------------------------------------------------------------

  private async executeAgent(
    input: ScanRepoDocsInput,
    workDir: string,
    repoSlug: string,
    inventory: RepoInventory,
    policyRules: import("@tilsley/shared").PolicyRule[],
    template?: import("@tilsley/shared").RepoTemplate | null,
  ): Promise<GardenerResult> {
    if (!this.agentFixer) {
      throw new Error("agent strategy requires an AgentFixerLlmPort");
    }

    const { owner, repo, token, base = "main" } = input;

    // Pre-load all .md files for the agent's context
    const docFiles = await this.loadDocFiles(workDir, inventory.allFiles);
    console.log(`[doc-gardener] Loaded ${docFiles.length} doc files for agent context`);

    // --- Single agent session (1 premium request) ---
    console.log(`[doc-gardener] Running agent session (SDK built-in tools)...`);
    const branch = `doc-gardener/update-docs-${Date.now()}`;
    await this.scanner.createBranch(workDir, branch);

    const result = await this.agentFixer.fix({
      workDir,
      inventory,
      docFiles,
      policyRules,
      repo: repoSlug,
      ...(template && { template }),
    });

    console.log(
      `[doc-gardener] Agent result: ${result.driftItems.length} drift items`
    );

    // --- Detect what the agent changed on disk ---
    const modifiedFiles = await this.scanner.getModifiedFiles(workDir);
    console.log(`[doc-gardener] Agent modified ${modifiedFiles.length} file(s): ${modifiedFiles.join(", ")}`);

    if (modifiedFiles.length === 0) {
      console.log(`[doc-gardener] No files modified — repo is clean or agent found nothing to fix`);
      return {
        status: "clean",
        driftItems: result.driftItems,
        iterationsUsed: 0,
        remainingGaps: 0,
      };
    }

    // --- Commit + PR ---
    await this.scanner.commitAndPush(
      workDir,
      branch,
      "docs: update documentation to match codebase"
    );

    // Build a minimal DocUpdatePlan for the PR body
    const plan: DocUpdatePlan = {
      repo: repoSlug,
      driftItems: result.driftItems,
      policyRules,
      fixes: result.driftItems.map((d, i) => ({
        drift: d,
        action: "update-claim" as const,
        file: d.file,
        section: d.section,
        description: d.detail,
        priority: i + 1,
      })),
      giveUp: false,
      planReasoning: result.planReasoning,
    };

    const prBody = formatPrBody(plan, 0, 0);
    const pr = await this.github.createPullRequest(owner, repo, {
      title: "docs: fix documentation drift",
      body: prBody,
      head: branch,
      base,
    });

    console.log(`[doc-gardener] PR opened: ${pr.url} (status: pr-opened)`);
    return {
      status: "pr-opened",
      driftItems: result.driftItems,
      plan,
      iterationsUsed: 0,
      remainingGaps: 0,
      prUrl: pr.url,
    };
  }

  // ---------------------------------------------------------------------------
  // Agentic strategy: multi-role loop (existing behaviour)
  // ---------------------------------------------------------------------------

  private async executeAgentic(
    input: ScanRepoDocsInput,
    workDir: string,
    repoSlug: string,
    inventory: RepoInventory,
    deterministicDrift: DriftItem[],
    policyRules: import("@tilsley/shared").PolicyRule[],
  ): Promise<GardenerResult> {
    if (!this.agenticPorts) {
      throw new Error("agentic strategy requires AgenticPorts (docAnalyzer, codeAnalyzer, planner, docWriter)");
    }

    const { owner, repo, token, base = "main", maxIterations = 3 } = input;
    const { docAnalyzer, codeAnalyzer, planner, docWriter } = this.agenticPorts;
    const currentDoc = inventory.readmeContent ?? "";

    // --- Doc Analyzer: extract claims from README ---
    console.log(`[doc-gardener] Extracting claims from documentation...`);
    const claims = currentDoc
      ? await docAnalyzer.extractClaims(currentDoc, "README.md")
      : [];
    console.log(`[doc-gardener] Extracted ${claims.length} claims`);

    // --- Code Analyzer: read source files, produce CodeSnapshot ---
    console.log(`[doc-gardener] Analyzing source code...`);
    const selectedPaths = selectFilesForAnalysis(inventory.allFiles, claims);
    const sourceFiles = await this.loadSourceFiles(workDir, selectedPaths);
    const codeSnapshot = await codeAnalyzer.analyzeCode(
      sourceFiles,
      inventory
    );
    console.log(
      `[doc-gardener] Code snapshot: ${codeSnapshot.entryPoints.length} entry points, ${codeSnapshot.architecturalFacts.length} facts`
    );

    // --- Planner: compare claims vs code → DocUpdatePlan ---
    console.log(`[doc-gardener] Planning documentation fixes...`);
    let plan = await planner.analyzeGapsAndPlan({
      claims,
      codeSnapshot,
      deterministicDrift,
      policyRules,
      currentDoc,
      repo: repoSlug,
    });
    console.log(
      `[doc-gardener] Plan: ${plan.fixes.length} fixes, giveUp=${plan.giveUp}`
    );

    if (plan.fixes.length === 0 && deterministicDrift.length === 0) {
      console.log(`[doc-gardener] No drift detected — repo is clean`);
      return {
        status: "clean",
        driftItems: [],
        iterationsUsed: 0,
        remainingGaps: 0,
      };
    }

    if (plan.giveUp) {
      console.log(`[doc-gardener] Planner gave up: ${plan.planReasoning}`);
      return {
        status: "gave-up",
        driftItems: plan.driftItems,
        plan,
        iterationsUsed: 0,
        remainingGaps: plan.fixes.length,
      };
    }

    // --- Agentic loop ---
    // Track file contents across iterations
    const fileContents = new Map<string, string | null>();
    if (currentDoc) {
      fileContents.set("README.md", currentDoc);
    }

    let iterationsUsed = 0;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      iterationsUsed = iteration;
      console.log(
        `[doc-gardener] === Iteration ${iteration}/${maxIterations} — ${plan.fixes.length} fixes ===`
      );

      // --- Writer: apply each fix (one at a time, priority order) ---
      for (const fix of plan.fixes) {
        const existing = fileContents.get(fix.file) ?? null;
        console.log(
          `[doc-gardener]   Applying fix [${fix.priority}]: ${fix.action} ${fix.file}${fix.section ? ` § ${fix.section}` : ""}`
        );

        const result = await docWriter.applyFix({
          fix,
          currentContent: existing,
          codeSnapshot,
          policyRules,
        });

        fileContents.set(result.file, result.content);
        console.log(`[doc-gardener]   → ${result.changeDescription}`);
      }

      // --- Self-review: re-extract claims, re-plan ---
      const updatedDoc = fileContents.get("README.md") ?? "";

      console.log(`[doc-gardener] Re-extracting claims for review...`);
      const updatedClaims = updatedDoc
        ? await docAnalyzer.extractClaims(updatedDoc, "README.md")
        : [];

      console.log(`[doc-gardener] Re-running gap analysis...`);
      const reviewPlan = await planner.analyzeGapsAndPlan({
        claims: updatedClaims,
        codeSnapshot,
        deterministicDrift: [], // deterministic already addressed
        policyRules,
        currentDoc: updatedDoc,
        repo: repoSlug,
      });

      console.log(
        `[doc-gardener] Review: ${reviewPlan.fixes.length} remaining gaps, giveUp=${reviewPlan.giveUp}`
      );

      if (reviewPlan.fixes.length === 0) {
        console.log(`[doc-gardener] All gaps resolved after ${iteration} iteration(s)`);
        plan = { ...plan, fixes: [], planReasoning: reviewPlan.planReasoning };
        break;
      }

      if (reviewPlan.giveUp) {
        console.log(`[doc-gardener] Planner gave up on review: ${reviewPlan.planReasoning}`);
        plan = reviewPlan;
        break;
      }

      // Continue with remaining fixes
      plan = reviewPlan;
    }

    const remainingGaps = plan.fixes.length;
    const allDrift = plan.driftItems;

    // --- Determine outcome ---
    const hasChanges = [...fileContents.entries()].some(
      ([file, content]) => {
        if (file === "README.md") return content !== currentDoc;
        return content !== null;
      }
    );

    if (!hasChanges) {
      console.log(`[doc-gardener] No changes produced`);
      return {
        status: remainingGaps > 0 ? "loop-exhausted" : "clean",
        driftItems: allDrift,
        plan,
        iterationsUsed,
        remainingGaps,
      };
    }

    // --- Write files, commit, push, open PR ---
    const branch = `doc-gardener/update-docs-${Date.now()}`;
    await this.scanner.createBranch(workDir, branch);

    for (const [file, content] of fileContents) {
      if (content !== null) {
        console.log(`[doc-gardener] Writing ${file}`);
        await this.scanner.writeFile(workDir, file, content);
      }
    }

    await this.scanner.commitAndPush(
      workDir,
      branch,
      "docs: update documentation to match codebase"
    );

    const prBody = formatPrBody(plan, iterationsUsed, remainingGaps);
    const pr = await this.github.createPullRequest(owner, repo, {
      title: "docs: fix documentation drift",
      body: prBody,
      head: branch,
      base,
    });

    const status = remainingGaps > 0
      ? plan.giveUp
        ? "gave-up"
        : "loop-exhausted"
      : "pr-opened";

    console.log(`[doc-gardener] PR opened: ${pr.url} (status: ${status})`);
    return {
      status,
      driftItems: allDrift,
      plan,
      iterationsUsed,
      remainingGaps,
      prUrl: pr.url,
    };
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private async extractInventory(workDir: string): Promise<RepoInventory> {
    const allFiles = await this.scanner.listFiles(workDir);

    // package.json scripts
    let scripts: Record<string, string> = {};
    const pkgRaw = await this.scanner.readFile(workDir, "package.json");
    if (pkgRaw) {
      try {
        const pkg = JSON.parse(pkgRaw) as {
          scripts?: Record<string, string>;
        };
        scripts = pkg.scripts ?? {};
      } catch {
        /* invalid json */
      }
    }

    // .env.example vars
    let envVars: string[] = [];
    const envRaw = await this.scanner.readFile(workDir, ".env.example");
    if (envRaw) {
      envVars = envRaw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split("=")[0].trim())
        .filter(Boolean);
    }

    // Config files
    const configPatterns = [
      "tsconfig.json",
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
      ".eslintrc.js",
      ".eslintrc.json",
      ".eslintrc.yml",
      "eslint.config.js",
      "eslint.config.mjs",
      ".prettierrc",
      ".prettierrc.json",
      "jest.config.js",
      "jest.config.ts",
      "vitest.config.ts",
    ];
    const configFiles = allFiles.filter(
      (f) =>
        configPatterns.some((p) => f === p || f.endsWith(`/${p}`)) ||
        f.startsWith(".github/workflows/")
    );

    // README
    const readmeContent = await this.scanner.readFile(workDir, "README.md");

    return { scripts, envVars, configFiles, allFiles, readmeContent };
  }

  private async loadDocFiles(
    workDir: string,
    allFiles: string[]
  ): Promise<Array<{ path: string; content: string }>> {
    const mdPaths = allFiles.filter((f) => f.endsWith(".md"));
    const docs: Array<{ path: string; content: string }> = [];

    for (const p of mdPaths) {
      const content = await this.scanner.readFile(workDir, p);
      if (content !== null) {
        docs.push({ path: p, content });
      }
    }

    return docs;
  }

  private async loadSourceFiles(
    workDir: string,
    paths: string[]
  ): Promise<SourceFile[]> {
    const files: Array<{ path: string; content: string }> = [];

    for (const p of paths) {
      const content = await this.scanner.readFile(workDir, p);
      if (content !== null) {
        files.push({ path: p, content });
      }
    }

    return enforceByteLimit(files);
  }
}
