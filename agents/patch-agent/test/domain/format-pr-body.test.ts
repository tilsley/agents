import { describe, expect, test } from "bun:test";
import { formatPrBody, formatCommitMessage } from "../../src/domain/utils/format-pr-body";
import type { PatchPlan, PackageFix } from "../../src/domain/entities/patch-plan";
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

function makePlan(overrides: Partial<PatchPlan> = {}): PatchPlan {
  const vuln = makeVuln();
  const fix: PackageFix = {
    packageName: "lodash",
    fromVersion: "4.17.4",
    toVersion: "4.17.21",
    vulnerabilities: [vuln],
    highestSeverity: "high",
  };
  return {
    fixes: [fix],
    skipped: [],
    unfixable: [],
    branch: "chore-bot/patch-lodash-4.17.21-1234",
    prTitle: "fix(deps): patch lodash 4.17.4 → 4.17.21 (1 vuln)",
    ...overrides,
  };
}

describe("formatPrBody", () => {
  test("includes package name and version bump", () => {
    const body = formatPrBody(makePlan(), "tilsley", "agents");
    expect(body).toContain("lodash");
    expect(body).toContain("4.17.4");
    expect(body).toContain("4.17.21");
  });

  test("includes CVE reference", () => {
    const body = formatPrBody(makePlan(), "tilsley", "agents");
    expect(body).toContain("CVE-2021-23337");
  });

  test("includes severity label", () => {
    const body = formatPrBody(makePlan(), "tilsley", "agents");
    expect(body).toContain("HIGH");
  });

  test("includes chore-bot attribution", () => {
    const body = formatPrBody(makePlan(), "tilsley", "agents");
    expect(body).toContain("chore-bot");
  });

  test("includes unfixable section when vulns cannot be upgraded", () => {
    const unfixable = makeVuln({ id: "UNFIXABLE", isUpgradable: false });
    const plan = makePlan({ unfixable: [unfixable] });
    const body = formatPrBody(plan, "tilsley", "agents");
    expect(body).toContain("Unfixable");
  });

  test("omits unfixable section when nothing is unfixable", () => {
    const body = formatPrBody(makePlan({ unfixable: [] }), "tilsley", "agents");
    expect(body).not.toContain("Unfixable");
  });

  test("includes skipped section when safety policy rejects a fix", () => {
    const skippedFix: PackageFix = {
      packageName: "moment",
      fromVersion: "2.29.4",
      toVersion: "2.29.1",
      vulnerabilities: [],
      highestSeverity: "high",
    };
    const plan = makePlan({ skipped: [{ fix: skippedFix, reason: "Semver downgrade: 2.29.4 → 2.29.1 — skipped to avoid breaking change" }] });
    const body = formatPrBody(plan, "tilsley", "agents");
    expect(body).toContain("Skipped");
    expect(body).toContain("moment");
    expect(body).toContain("downgrade");
  });

  test("omits skipped section when no fixes were skipped", () => {
    const body = formatPrBody(makePlan({ skipped: [] }), "tilsley", "agents");
    expect(body).not.toContain("Skipped");
  });

  test("handles vuln with no CVEs", () => {
    const vuln = makeVuln({ cves: [] });
    const fix: PackageFix = {
      packageName: "lodash",
      fromVersion: "4.17.4",
      toVersion: "4.17.21",
      vulnerabilities: [vuln],
      highestSeverity: "high",
    };
    const plan = makePlan({ fixes: [fix] });
    // Should not throw and should not include empty parens
    const body = formatPrBody(plan, "tilsley", "agents");
    expect(body).toBeTruthy();
    expect(body).not.toContain("()");
  });
});

describe("formatCommitMessage", () => {
  test("single fix includes package and target version", () => {
    const msg = formatCommitMessage(makePlan());
    expect(msg).toContain("lodash");
    expect(msg).toContain("4.17.21");
  });

  test("single fix includes CVE when present", () => {
    const msg = formatCommitMessage(makePlan());
    expect(msg).toContain("CVE-2021-23337");
  });

  test("single fix with no CVEs omits parenthetical", () => {
    const vuln = makeVuln({ cves: [] });
    const fix: PackageFix = {
      packageName: "lodash",
      fromVersion: "4.17.4",
      toVersion: "4.17.21",
      vulnerabilities: [vuln],
      highestSeverity: "high",
    };
    const msg = formatCommitMessage(makePlan({ fixes: [fix] }));
    expect(msg).not.toContain("()");
  });

  test("multiple fixes lists all packages", () => {
    const fix1: PackageFix = {
      packageName: "lodash",
      fromVersion: "4.17.4",
      toVersion: "4.17.21",
      vulnerabilities: [makeVuln()],
      highestSeverity: "high",
    };
    const fix2: PackageFix = {
      packageName: "express",
      fromVersion: "4.17.0",
      toVersion: "4.18.0",
      vulnerabilities: [makeVuln({ packageName: "express" })],
      highestSeverity: "medium",
    };
    const msg = formatCommitMessage(makePlan({ fixes: [fix1, fix2] }));
    expect(msg).toContain("lodash");
    expect(msg).toContain("express");
  });
});
