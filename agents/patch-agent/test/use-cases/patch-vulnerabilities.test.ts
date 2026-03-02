import { describe, expect, test, mock, beforeEach } from "bun:test";
import { PatchVulnerabilities } from "../../src/application/use-cases/patch-vulnerabilities";
import type { SnykPort } from "../../src/application/ports/snyk.port";
import type { GitPort } from "../../src/application/ports/git.port";
import type { ConductorPort } from "../../src/application/ports/conductor.port";
import type { PatchAdvisorLlmPort, PatchAdvice } from "../../src/application/ports/patch-advisor-llm.port";
import type { MemoryPort } from "@tilsley/shared";
import type { GitHubPort } from "@tilsley/shared";
import type { VulnerabilityReport } from "../../src/domain/entities/vulnerability";

// ---- Factories ----

function makeReport(overrides: Partial<VulnerabilityReport> = {}): VulnerabilityReport {
  return {
    ok: false,
    packageManager: "npm",
    projectName: "test-project",
    vulnerabilities: [
      {
        id: "SNYK-JS-LODASH-1",
        title: "Prototype Pollution",
        severity: "high",
        packageName: "lodash",
        installedVersion: "4.17.4",
        fixedIn: ["4.17.21"],
        cves: ["CVE-2021-23337"],
        isUpgradable: true,
        upgradePath: [false, "lodash@4.17.21"],
      },
    ],
    ...overrides,
  };
}

function makeSnyk(report: VulnerabilityReport): SnykPort {
  return { scan: mock(async () => report) };
}

function makeGit(): GitPort {
  return {
    cloneRepo: mock(async () => {}),
    createBranch: mock(async () => {}),
    applyPackageFixes: mock(async () => {}),
    commitAndPush: mock(async () => {}),
    detectPackageManager: mock(async () => "npm" as const),
    runChecks: mock(async () => ({ success: true, step: "test" as const, output: "" })),
  };
}

function makeGitHub(prNumber = 42): GitHubPort {
  return {
    createPullRequest: mock(async () => ({
      number: prNumber,
      url: `https://github.com/tilsley/agents/pull/${prNumber}`,
    })),
    getPullRequestForCheckRun: mock(async () => null),
    getCheckRunAnnotations: mock(async () => ""),
    getCheckRunLog: mock(async () => ""),
    rerunCheckRun: mock(async () => {}),
    closePullRequest: mock(async () => {}),
    getCheckRunsForRef: mock(async () => []),
    getPullRequestDiff: mock(async () => ""),
    commentOnPullRequest: mock(async () => {}),
    approvePullRequest: mock(async () => {}),
    requestChangesOnPullRequest: mock(async () => {}),
    mergePullRequest: mock(async () => {}),
  };
}

function makeConductor(): ConductorPort {
  return { emit: mock(async () => {}) };
}

function makeMemory(): MemoryPort {
  return {
    search: mock(async () => []),
    list: mock(async () => []),
    store: mock(async () => {}),
    replace: mock(async () => {}),
  };
}

function makeAdvisor(advice: Partial<PatchAdvice> = {}): PatchAdvisorLlmPort {
  const full: PatchAdvice = {
    warnings: [],
    migrationNotes: [],
    scopingRecommendation: null,
    riskLevel: "low",
    packagesToDefer: [],
    ...advice,
  };
  return { advise: mock(async () => full) };
}

// ---- Tests ----

describe("PatchVulnerabilities.execute", () => {
  test("returns clean when snyk reports no vulnerabilities", async () => {
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport({ ok: true, vulnerabilities: [] })),
      makeGit(),
      makeGitHub(),
      makeConductor()
    );

    const result = await useCase.execute({
      owner: "tilsley",
      repo: "agents",
      token: "fake-token",
    });

    expect(result.status).toBe("clean");
  });

  test("returns no-fixable-vulns when vulns exist but none meet min severity", async () => {
    const useCase = new PatchVulnerabilities(
      makeSnyk(
        makeReport({
          ok: false,
          vulnerabilities: [
            {
              id: "SNYK-LOW",
              title: "Low severity",
              severity: "low",
              packageName: "pkg",
              installedVersion: "1.0.0",
              fixedIn: ["1.0.1"],
              cves: [],
              isUpgradable: true,
              upgradePath: [false, "pkg@1.0.1"],
            },
          ],
        })
      ),
      makeGit(),
      makeGitHub(),
      makeConductor()
    );

    const result = await useCase.execute({
      owner: "tilsley",
      repo: "agents",
      token: "fake-token",
      minSeverity: "high",
    });

    expect(result.status).toBe("no-fixable-vulns");
  });

  test("returns pr-created on successful patch flow", async () => {
    const github = makeGitHub(99);
    const conductor = makeConductor();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      conductor
    );

    const result = await useCase.execute({
      owner: "tilsley",
      repo: "agents",
      token: "fake-token",
    });

    expect(result.status).toBe("pr-created");
    expect(result.prNumber).toBe(99);
  });

  test("clones repo before scanning", async () => {
    const git = makeGit();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport({ ok: true, vulnerabilities: [] })),
      git,
      makeGitHub(),
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(git.cloneRepo).toHaveBeenCalledTimes(1);
  });

  test("creates branch before applying fixes", async () => {
    const git = makeGit();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      git,
      makeGitHub(),
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(git.createBranch).toHaveBeenCalledTimes(1);
    expect(git.applyPackageFixes).toHaveBeenCalledTimes(1);
  });

  test("commits and pushes after applying fixes", async () => {
    const git = makeGit();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      git,
      makeGitHub(),
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(git.commitAndPush).toHaveBeenCalledTimes(1);
  });

  test("opens PR with correct owner/repo", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(github.createPullRequest).toHaveBeenCalledWith(
      "tilsley",
      "agents",
      expect.objectContaining({ base: "main" })
    );
  });

  test("uses custom base branch when provided", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      makeConductor()
    );

    await useCase.execute({
      owner: "tilsley",
      repo: "agents",
      token: "t",
      base: "develop",
    });

    expect(github.createPullRequest).toHaveBeenCalledWith(
      "tilsley",
      "agents",
      expect.objectContaining({ base: "develop" })
    );
  });

  test("emits patch-agent.completed event after PR creation", async () => {
    const conductor = makeConductor();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      makeGitHub(77),
      conductor
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(conductor.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "patch-agent.completed",
        payload: expect.objectContaining({ prNumber: 77 }),
      })
    );
  });

  test("does not open PR when repo is clean", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport({ ok: true, vulnerabilities: [] })),
      makeGit(),
      github,
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  test("does not emit conductor event when no PR is created", async () => {
    const conductor = makeConductor();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport({ ok: true, vulnerabilities: [] })),
      makeGit(),
      makeGitHub(),
      conductor
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(conductor.emit).not.toHaveBeenCalled();
  });

  test("PR title follows conventional commits format", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      makeConductor()
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    const call = (github.createPullRequest as ReturnType<typeof mock>).mock.calls[0];
    const opts = call[2] as { title: string };
    expect(opts.title).toMatch(/^fix\(deps\):/);
  });

  test("deferred package is not applied or committed", async () => {
    const git = makeGit();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      git,
      makeGitHub(),
      makeConductor(),
      makeMemory(),
      makeAdvisor({ packagesToDefer: ["lodash"] })
    );

    const result = await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(result.status).toBe("no-fixable-vulns");
    expect(git.applyPackageFixes).not.toHaveBeenCalled();
    expect(git.commitAndPush).not.toHaveBeenCalled();
  });

  test("deferred package does not open a PR", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      makeConductor(),
      makeMemory(),
      makeAdvisor({ packagesToDefer: ["lodash"] })
    );

    await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(github.createPullRequest).not.toHaveBeenCalled();
  });

  test("non-deferred packages still proceed when only some are deferred", async () => {
    const report = makeReport({
      vulnerabilities: [
        {
          id: "SNYK-1",
          title: "Vuln A",
          severity: "high",
          packageName: "lodash",
          installedVersion: "4.17.4",
          fixedIn: ["4.17.21"],
          cves: [],
          isUpgradable: true,
          upgradePath: [false, "lodash@4.17.21"],
        },
        {
          id: "SNYK-2",
          title: "Vuln B",
          severity: "high",
          packageName: "express",
          installedVersion: "4.17.0",
          fixedIn: ["4.18.2"],
          cves: [],
          isUpgradable: true,
          upgradePath: [false, "express@4.18.2"],
        },
      ],
    });

    const github = makeGitHub(55);
    const git = makeGit();
    const useCase = new PatchVulnerabilities(
      makeSnyk(report),
      git,
      github,
      makeConductor(),
      makeMemory(),
      makeAdvisor({ packagesToDefer: ["lodash"] }) // defer lodash, keep express
    );

    const result = await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    expect(result.status).toBe("pr-created");
    // express fix should have been applied
    const applyCall = (git.applyPackageFixes as ReturnType<typeof mock>).mock.calls[0];
    const fixes = applyCall[1] as Array<{ packageName: string }>;
    expect(fixes.map((f) => f.packageName)).not.toContain("lodash");
    expect(fixes.map((f) => f.packageName)).toContain("express");
  });

  test("unknown package name in packagesToDefer is silently ignored", async () => {
    const github = makeGitHub();
    const useCase = new PatchVulnerabilities(
      makeSnyk(makeReport()),
      makeGit(),
      github,
      makeConductor(),
      makeMemory(),
      makeAdvisor({ packagesToDefer: ["does-not-exist"] })
    );

    const result = await useCase.execute({ owner: "tilsley", repo: "agents", token: "t" });

    // lodash fix should still proceed
    expect(result.status).toBe("pr-created");
    expect(github.createPullRequest).toHaveBeenCalledTimes(1);
  });
});
