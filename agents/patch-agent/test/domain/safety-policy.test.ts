import { describe, expect, test } from "bun:test";
import { filterSafeUpgrades } from "../../src/domain/policies/safety-policy";
import type { PackageFix } from "../../src/domain/entities/patch-plan";

function makeFix(pkg: string, from: string, to: string): PackageFix {
  return {
    packageName: pkg,
    fromVersion: from,
    toVersion: to,
    vulnerabilities: [],
    highestSeverity: "high",
  };
}

describe("filterSafeUpgrades", () => {
  test("allows a normal patch upgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("lodash", "4.17.4", "4.17.21")]);
    expect(safe).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test("allows a minor upgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("express", "4.17.0", "4.18.2")]);
    expect(safe).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test("allows a major upgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("react", "17.0.2", "18.2.0")]);
    expect(safe).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test("skips a patch downgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("lodash", "4.17.21", "4.17.4")]);
    expect(safe).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/downgrade/i);
    expect(skipped[0].fix.packageName).toBe("lodash");
  });

  test("skips a minor downgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("express", "4.18.2", "4.17.0")]);
    expect(safe).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  test("skips a major downgrade", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("react", "18.2.0", "17.0.2")]);
    expect(safe).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  test("same version is treated as safe (no-op upgrade)", () => {
    const { safe, skipped } = filterSafeUpgrades([makeFix("semver", "7.3.8", "7.3.8")]);
    expect(safe).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  test("mixed: one safe, one downgrade", () => {
    const fixes = [
      makeFix("lodash", "4.17.4", "4.17.21"),   // safe
      makeFix("moment", "2.29.4", "2.29.1"),     // downgrade
    ];
    const { safe, skipped } = filterSafeUpgrades(fixes);
    expect(safe).toHaveLength(1);
    expect(safe[0].packageName).toBe("lodash");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].fix.packageName).toBe("moment");
  });

  test("returns empty arrays for empty input", () => {
    const { safe, skipped } = filterSafeUpgrades([]);
    expect(safe).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});
