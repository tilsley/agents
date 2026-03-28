import { describe, expect, test, mock } from "bun:test";
import { UpgradePackage, type UpgradePackageInput } from "../../src/application/use-cases/upgrade-package";
import type { UpgradeGitPort, TestResult } from "../../src/application/ports/upgrade-git.port";
import type { ResearchLlmPort } from "../../src/application/ports/research-llm.port";
import type { FixLlmPort } from "../../src/application/ports/fix-llm.port";
import type { ConductorPort } from "../../src/application/ports/conductor.port";
import type { DiscoveryLlmPort, UpgradeCandidate } from "../../src/application/ports/discovery-llm.port";
import type { GitHubPort } from "@tilsley/shared";
import type { UpgradePlan } from "../../src/domain/entities/upgrade-plan";

function makePlan(overrides: Partial<UpgradePlan> = {}): UpgradePlan {
  return {
    target: { packageName: "express", fromVersion: "4.17.0", toVersion: "5.0.0" },
    riskLevel: "medium",
    shouldProceed: true,
    expectedBreakingChanges: [],
    knownIssues: [],
    researchSummary: "Minor breaking changes in middleware API.",
    ...overrides,
  };
}

function makeInput(overrides: Partial<UpgradePackageInput> = {}): UpgradePackageInput {
  return {
    owner: "test-org",
    repo: "test-repo",
    token: "gh-token",
    packageName: "express",
    toVersion: "5.0.0",
    fromVersion: "4.17.0",
    ...overrides,
  };
}

function createMockGit(opts: {
  installedVersion?: string | null;
  testPasses?: boolean;
} = {}): UpgradeGitPort {
  const { installedVersion = "4.17.0", testPasses = true } = opts;
  return {
    cloneRepo: mock(() => Promise.resolve()),
    createBranch: mock(() => Promise.resolve()),
    getInstalledVersion: mock(() => Promise.resolve(installedVersion)),
    bumpPackageVersion: mock(() => Promise.resolve()),
    runTests: mock((): Promise<TestResult> => Promise.resolve({ passed: testPasses, output: testPasses ? "" : "FAIL: test_foo\nTypeError: ...", exitCode: testPasses ? 0 : 1 })),
    getAllDependencies: mock(() => Promise.resolve({ express: "4.17.0", hono: "4.0.0" })),
    readFile: mock(() => Promise.resolve("// file content")),
    writeFile: mock(() => Promise.resolve()),
    listSourceFiles: mock(() => Promise.resolve(["src/index.ts"])),
    commitAndPush: mock(() => Promise.resolve()),
  };
}

function createMockGitHub(): GitHubPort {
  return {
    getPullRequestForCheckRun: mock(() => Promise.resolve(null)),
    getCheckRunAnnotations: mock(() => Promise.resolve("")),
    getCheckRunLog: mock(() => Promise.resolve("")),
    rerunCheckRun: mock(() => Promise.resolve()),
    closePullRequest: mock(() => Promise.resolve()),
    getCheckRunsForRef: mock(() => Promise.resolve([])),
    getPullRequestDiff: mock(() => Promise.resolve("")),
    commentOnPullRequest: mock(() => Promise.resolve()),
    approvePullRequest: mock(() => Promise.resolve()),
    requestChangesOnPullRequest: mock(() => Promise.resolve()),
    mergePullRequest: mock(() => Promise.resolve()),
    createPullRequest: mock(() => Promise.resolve({ number: 42, url: "https://github.com/test-org/test-repo/pull/42" })),
    getReleaseNotes: mock(() => Promise.resolve("")),
    searchIssues: mock(() => Promise.resolve([])),
  };
}

function createMockResearchLlm(plan: UpgradePlan = makePlan()): ResearchLlmPort {
  return { synthesise: mock((_target, _research, _toolExecutor?) => Promise.resolve(plan)) };
}

function createMockFixLlm(): FixLlmPort {
  return {
    suggestFix: mock(() => Promise.resolve({ patches: [], reasoning: "No fix needed", confidence: 0.9, giveUp: false })),
  };
}

function createMockConductor(): ConductorPort {
  return { emit: mock(() => Promise.resolve()) };
}

function createMockDiscovery(selected: UpgradeCandidate | null = null): DiscoveryLlmPort {
  return { selectTarget: mock(() => Promise.resolve(selected)) };
}

const MOCK_CANDIDATE: UpgradeCandidate = {
  packageName: "express",
  currentVersion: "4.17.0",
  latestVersion: "5.0.0",
  riskLevel: "critical",
};

describe("UpgradePackage", () => {
  test("returns already-current when fromVersion equals toVersion", async () => {
    const git = createMockGit({ installedVersion: "5.0.0" });
    const useCase = new UpgradePackage(git, createMockGitHub(), createMockResearchLlm(), createMockFixLlm(), createMockConductor());

    const result = await useCase.execute(makeInput({ fromVersion: undefined }));

    expect(result.status).toBe("already-current");
    expect(git.bumpPackageVersion).not.toHaveBeenCalled();
  });

  test("returns research-blocked when plan says not to proceed", async () => {
    const blockedPlan = makePlan({ shouldProceed: false, riskLevel: "critical" });
    const researchLlm = createMockResearchLlm(blockedPlan);
    const git = createMockGit();
    const useCase = new UpgradePackage(git, createMockGitHub(), researchLlm, createMockFixLlm(), createMockConductor());

    const result = await useCase.execute(makeInput());

    expect(result.status).toBe("research-blocked");
    expect(result.plan?.riskLevel).toBe("critical");
    expect(git.bumpPackageVersion).not.toHaveBeenCalled();
  });

  test("opens PR when tests pass immediately", async () => {
    const git = createMockGit({ testPasses: true });
    const github = createMockGitHub();
    const conductor = createMockConductor();
    const useCase = new UpgradePackage(git, github, createMockResearchLlm(), createMockFixLlm(), conductor);

    const result = await useCase.execute(makeInput());

    expect(result.status).toBe("pr-created");
    expect(result.testsPassingOnOpen).toBe(true);
    expect(result.prNumber).toBe(42);
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
    expect(conductor.emit).toHaveBeenCalledTimes(1);
  });

  test("runs fix loop when tests fail then opens PR", async () => {
    let callCount = 0;
    const git = createMockGit({ testPasses: false });
    // Tests fail first two calls then pass
    (git.runTests as ReturnType<typeof mock>).mockImplementation(() => {
      callCount++;
      const passed = callCount >= 3;
      return Promise.resolve({ passed, output: passed ? "" : "FAIL", exitCode: passed ? 0 : 1 });
    });

    const fixLlm = createMockFixLlm();
    const useCase = new UpgradePackage(git, createMockGitHub(), createMockResearchLlm(), fixLlm, createMockConductor(), undefined, 5);

    const result = await useCase.execute(makeInput());

    expect(result.status).toBe("pr-created");
    expect(result.testsPassingOnOpen).toBe(true);
    expect(result.iterationsUsed).toBeGreaterThan(0);
    expect(fixLlm.suggestFix).toHaveBeenCalled();
  });

  test("opens PR with fix-loop-exhausted when iterations run out", async () => {
    const git = createMockGit({ testPasses: false });
    const github = createMockGitHub();
    const useCase = new UpgradePackage(git, github, createMockResearchLlm(), createMockFixLlm(), createMockConductor(), undefined, 2);

    const result = await useCase.execute(makeInput());

    expect(result.status).toBe("fix-loop-exhausted");
    expect(result.testsPassingOnOpen).toBe(false);
    // PR still opened — human can finish the job
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
  });

  test("throws when package is not in the repo", async () => {
    const git = createMockGit({ installedVersion: null });
    const useCase = new UpgradePackage(git, createMockGitHub(), createMockResearchLlm(), createMockFixLlm(), createMockConductor());

    await expect(useCase.execute(makeInput({ fromVersion: undefined }))).rejects.toThrow();
  });

  test("passes toolExecutor with read_file, grep, list_files handlers to synthesise", async () => {
    const researchLlm = createMockResearchLlm();
    const git = createMockGit();
    const useCase = new UpgradePackage(git, createMockGitHub(), researchLlm, createMockFixLlm(), createMockConductor());

    await useCase.execute(makeInput());

    expect(researchLlm.synthesise).toHaveBeenCalledTimes(1);
    const toolExecutor = (researchLlm.synthesise as ReturnType<typeof mock>).mock.calls[0][2];
    expect(toolExecutor).toBeDefined();
    expect(typeof toolExecutor.read_file).toBe("function");
    expect(typeof toolExecutor.grep).toBe("function");
    expect(typeof toolExecutor.list_files).toBe("function");
  });

  test("emits upgrade.completed event", async () => {
    const conductor = createMockConductor();
    const useCase = new UpgradePackage(createMockGit(), createMockGitHub(), createMockResearchLlm(), createMockFixLlm(), conductor);

    await useCase.execute(makeInput());

    expect(conductor.emit).toHaveBeenCalledTimes(1);
    const event = (conductor.emit as ReturnType<typeof mock>).mock.calls[0][0];
    expect(event.type).toBe("upgrade.completed");
    expect(event.payload.packageName).toBe("express");
  });

  // --- Auto-discover mode ---

  test("auto-discover: calls discovery LLM and proceeds with selected candidate", async () => {
    const git = createMockGit();
    // getAllDependencies already returns express + hono from the base mock

    const discovery = createMockDiscovery(MOCK_CANDIDATE);
    const github = createMockGitHub();
    const useCase = new UpgradePackage(
      git, github, createMockResearchLlm(), createMockFixLlm(),
      createMockConductor(), undefined, 5, discovery
    );

    const result = await useCase.execute(makeInput({ packageName: undefined, toVersion: undefined }));

    expect(discovery.selectTarget).toHaveBeenCalled();
    expect(result.status).toBe("pr-created");
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
  });

  test("auto-discover: returns no-candidates when discovery LLM declines", async () => {
    const git = createMockGit();
    const discovery = createMockDiscovery(null); // LLM declines
    const useCase = new UpgradePackage(
      git, createMockGitHub(), createMockResearchLlm(), createMockFixLlm(),
      createMockConductor(), undefined, 5, discovery
    );

    const result = await useCase.execute(makeInput({ packageName: undefined, toVersion: undefined }));

    expect(result.status).toBe("no-candidates");
  });

  test("auto-discover: throws when no packageName and no discovery LLM configured", async () => {
    const useCase = new UpgradePackage(
      createMockGit(), createMockGitHub(), createMockResearchLlm(),
      createMockFixLlm(), createMockConductor()
      // no discovery LLM
    );

    await expect(
      useCase.execute(makeInput({ packageName: undefined, toVersion: undefined }))
    ).rejects.toThrow();
  });
});
