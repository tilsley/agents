import type { PackageFix, SkippedFix } from "../entities/patch-plan";

export interface SafetyFilterResult {
  safe: PackageFix[];
  skipped: SkippedFix[];
}

/**
 * Hard safety rules applied before any fix is executed.
 * These are deterministic — no LLM judgment required.
 *
 * Current rules:
 *  1. Semver downgrade: toVersion < fromVersion → always skip.
 */
export function filterSafeUpgrades(fixes: PackageFix[]): SafetyFilterResult {
  const safe: PackageFix[] = [];
  const skipped: SkippedFix[] = [];

  for (const fix of fixes) {
    const cmp = compareVersions(fix.toVersion, fix.fromVersion);
    if (cmp < 0) {
      skipped.push({
        fix,
        reason: `Semver downgrade: ${fix.fromVersion} → ${fix.toVersion} — skipped to avoid breaking change`,
      });
    } else {
      safe.push(fix);
    }
  }

  return { safe, skipped };
}

/** Compares semver strings x.y.z. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
