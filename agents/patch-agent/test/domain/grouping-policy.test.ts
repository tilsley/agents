import { describe, expect, test } from "bun:test";
import {
  groupVulnerabilitiesByFix,
  buildBranchName,
  buildPrTitle,
  buildPatchPlan,
} from "../../src/domain/policies/grouping-policy";
import type { Vulnerability } from "../../src/domain/entities/vulnerability";

function makeVuln(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "SNYK-JS-LODASH-1",
    title: "Prototype Pollution",
    severity: "high",
    packageName: "lodash",
    installedVersion: "4.17.4",
    fixedIn: ["4.17.21"],
    cves: ["CVE-2021-23337"],
    isUpgradable: true,
    upgradePath: [false, "lodash@4.17.21"],
    ...overrides,
  };
}

describe("groupVulnerabilitiesByFix", () => {
  test("single vuln produces single fix", () => {
    const fixes = groupVulnerabilitiesByFix([makeVuln()]);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].packageName).toBe("lodash");
    expect(fixes[0].toVersion).toBe("4.17.21");
    expect(fixes[0].fromVersion).toBe("4.17.4");
  });

  test("two CVEs in the same package collapse into one fix", () => {
    const vulns = [
      makeVuln({ id: "SNYK-1", cves: ["CVE-A"] }),
      makeVuln({ id: "SNYK-2", cves: ["CVE-B"] }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].vulnerabilities).toHaveLength(2);
  });

  test("two different packages produce two fixes", () => {
    const vulns = [
      makeVuln({ packageName: "lodash", upgradePath: [false, "lodash@4.17.21"] }),
      makeVuln({
        packageName: "express",
        installedVersion: "4.17.0",
        upgradePath: [false, "express@4.18.0"],
      }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    expect(fixes).toHaveLength(2);
    expect(fixes.map((f) => f.packageName).sort()).toEqual(["express", "lodash"]);
  });

  test("picks the higher version when two vulns suggest different targets", () => {
    const vulns = [
      makeVuln({ id: "SNYK-1", upgradePath: [false, "lodash@4.17.10"] }),
      makeVuln({ id: "SNYK-2", upgradePath: [false, "lodash@4.17.21"] }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    expect(fixes[0].toVersion).toBe("4.17.21");
  });

  test("skips non-upgradable vulns", () => {
    const fixes = groupVulnerabilitiesByFix([makeVuln({ isUpgradable: false })]);
    expect(fixes).toHaveLength(0);
  });

  test("skips vulns with empty upgradePath", () => {
    const fixes = groupVulnerabilitiesByFix([makeVuln({ upgradePath: [] })]);
    expect(fixes).toHaveLength(0);
  });

  test("sets highestSeverity correctly for mixed-severity group", () => {
    const vulns = [
      makeVuln({ id: "SNYK-1", severity: "medium" }),
      makeVuln({ id: "SNYK-2", severity: "critical" }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    expect(fixes[0].highestSeverity).toBe("critical");
  });

  test("returns empty for empty input", () => {
    expect(groupVulnerabilitiesByFix([])).toHaveLength(0);
  });
});

describe("buildBranchName", () => {
  test("single fix uses package name", () => {
    const fixes = groupVulnerabilitiesByFix([makeVuln()]);
    const branch = buildBranchName(fixes, "tilsley", "agents");
    expect(branch).toMatch(/^chore-bot\/patch-lodash-4\.17\.21-\d+$/);
  });

  test("multiple fixes uses count", () => {
    const vulns = [
      makeVuln({ packageName: "lodash", upgradePath: [false, "lodash@4.17.21"] }),
      makeVuln({
        packageName: "express",
        upgradePath: [false, "express@4.18.0"],
      }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    const branch = buildBranchName(fixes, "tilsley", "agents");
    expect(branch).toMatch(/^chore-bot\/patch-vulns-2-packages-\d+$/);
  });

  test("scoped package names use hyphens not slashes", () => {
    const vulns = [makeVuln({ packageName: "@scope/pkg", upgradePath: [false, "@scope/pkg@2.0.0"] })];
    const fixes = groupVulnerabilitiesByFix(vulns);
    const branch = buildBranchName(fixes, "tilsley", "agents");
    expect(branch).not.toContain("/scope");
    expect(branch).toMatch(/^chore-bot\/patch-/);
  });
});

describe("buildPrTitle", () => {
  test("single fix includes package name and version range", () => {
    const fixes = groupVulnerabilitiesByFix([makeVuln()]);
    const title = buildPrTitle(fixes);
    expect(title).toContain("lodash");
    expect(title).toContain("4.17.21");
    expect(title).toContain("1 vuln");
  });

  test("multiple vulns says N vulns", () => {
    const vulns = [
      makeVuln({ id: "SNYK-1" }),
      makeVuln({ id: "SNYK-2" }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    const title = buildPrTitle(fixes);
    expect(title).toContain("2 vulns");
  });

  test("multiple packages includes count", () => {
    const vulns = [
      makeVuln({ packageName: "lodash", upgradePath: [false, "lodash@4.17.21"] }),
      makeVuln({ packageName: "express", upgradePath: [false, "express@4.18.0"] }),
    ];
    const fixes = groupVulnerabilitiesByFix(vulns);
    const title = buildPrTitle(fixes);
    expect(title).toContain("2 packages");
  });
});

describe("buildPatchPlan", () => {
  test("separates fixable from unfixable", () => {
    const vulns = [
      makeVuln({ isUpgradable: true }),
      makeVuln({ id: "UNFIXABLE", isUpgradable: false, upgradePath: [] }),
    ];
    const plan = buildPatchPlan(vulns, "tilsley", "agents");
    expect(plan.fixes).toHaveLength(1);
    expect(plan.unfixable).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  test("sets branch and prTitle", () => {
    const plan = buildPatchPlan([makeVuln()], "tilsley", "agents");
    expect(plan.branch).toMatch(/^chore-bot\//);
    expect(plan.prTitle).toBeTruthy();
  });

  test("moves downgrade to skipped, not fixes", () => {
    const downgrade = makeVuln({
      packageName: "lodash",
      installedVersion: "4.17.21",
      upgradePath: [false, "lodash@4.17.4"], // older version
    });
    const plan = buildPatchPlan([downgrade], "tilsley", "agents");
    expect(plan.fixes).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/downgrade/i);
  });
});
