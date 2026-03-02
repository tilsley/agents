import { describe, expect, test } from "bun:test";
import {
  SEVERITY_ORDER,
  getSeverityScore,
  meetsMinSeverity,
  filterByMinSeverity,
  getHighestSeverity,
} from "../../src/domain/policies/severity-policy";
import type { Vulnerability } from "../../src/domain/entities/vulnerability";

function makeVuln(severity: Vulnerability["severity"]): Vulnerability {
  return {
    id: `SNYK-${severity}`,
    title: `Test ${severity} vuln`,
    severity,
    packageName: "test-pkg",
    installedVersion: "1.0.0",
    fixedIn: ["1.0.1"],
    cves: [],
    isUpgradable: true,
    upgradePath: [false, "test-pkg@1.0.1"],
  };
}

describe("SEVERITY_ORDER", () => {
  test("critical is highest", () => {
    expect(SEVERITY_ORDER.critical).toBeGreaterThan(SEVERITY_ORDER.high);
  });

  test("correct ordering: critical > high > medium > low", () => {
    expect(SEVERITY_ORDER.critical).toBeGreaterThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeGreaterThan(SEVERITY_ORDER.medium);
    expect(SEVERITY_ORDER.medium).toBeGreaterThan(SEVERITY_ORDER.low);
  });
});

describe("getSeverityScore", () => {
  test("returns correct scores", () => {
    expect(getSeverityScore("critical")).toBe(SEVERITY_ORDER.critical);
    expect(getSeverityScore("high")).toBe(SEVERITY_ORDER.high);
    expect(getSeverityScore("medium")).toBe(SEVERITY_ORDER.medium);
    expect(getSeverityScore("low")).toBe(SEVERITY_ORDER.low);
  });
});

describe("meetsMinSeverity", () => {
  test("critical meets high threshold", () => {
    expect(meetsMinSeverity("critical", "high")).toBe(true);
  });

  test("high meets high threshold", () => {
    expect(meetsMinSeverity("high", "high")).toBe(true);
  });

  test("medium does not meet high threshold", () => {
    expect(meetsMinSeverity("medium", "high")).toBe(false);
  });

  test("low does not meet high threshold", () => {
    expect(meetsMinSeverity("low", "high")).toBe(false);
  });

  test("medium meets medium threshold", () => {
    expect(meetsMinSeverity("medium", "medium")).toBe(true);
  });

  test("low meets low threshold", () => {
    expect(meetsMinSeverity("low", "low")).toBe(true);
  });

  test("defaults to high if no minSeverity provided", () => {
    expect(meetsMinSeverity("high")).toBe(true);
    expect(meetsMinSeverity("medium")).toBe(false);
  });
});

describe("filterByMinSeverity", () => {
  const vulns = [
    makeVuln("critical"),
    makeVuln("high"),
    makeVuln("medium"),
    makeVuln("low"),
  ];

  test("filters to critical and high by default", () => {
    const result = filterByMinSeverity(vulns);
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.severity)).toEqual(["critical", "high"]);
  });

  test("includes all when minSeverity is low", () => {
    expect(filterByMinSeverity(vulns, "low")).toHaveLength(4);
  });

  test("only critical when minSeverity is critical", () => {
    const result = filterByMinSeverity(vulns, "critical");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("critical");
  });

  test("returns empty for empty input", () => {
    expect(filterByMinSeverity([])).toHaveLength(0);
  });
});

describe("getHighestSeverity", () => {
  test("returns critical when present", () => {
    expect(
      getHighestSeverity([makeVuln("high"), makeVuln("critical"), makeVuln("medium")])
    ).toBe("critical");
  });

  test("returns high when no critical", () => {
    expect(getHighestSeverity([makeVuln("medium"), makeVuln("high")])).toBe("high");
  });

  test("returns low for empty array", () => {
    expect(getHighestSeverity([])).toBe("low");
  });

  test("returns single severity for single-element array", () => {
    expect(getHighestSeverity([makeVuln("medium")])).toBe("medium");
  });
});
