import type { Vulnerability, VulnerabilitySeverity } from "../entities/vulnerability";

export const SEVERITY_ORDER: Record<VulnerabilitySeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const DEFAULT_MIN_SEVERITY: VulnerabilitySeverity = "high";

export function getSeverityScore(severity: VulnerabilitySeverity): number {
  return SEVERITY_ORDER[severity] ?? 0;
}

export function meetsMinSeverity(
  severity: VulnerabilitySeverity,
  minSeverity: VulnerabilitySeverity = DEFAULT_MIN_SEVERITY
): boolean {
  return getSeverityScore(severity) >= getSeverityScore(minSeverity);
}

export function filterByMinSeverity(
  vulns: Vulnerability[],
  minSeverity: VulnerabilitySeverity = DEFAULT_MIN_SEVERITY
): Vulnerability[] {
  return vulns.filter((v) => meetsMinSeverity(v.severity, minSeverity));
}

export function getHighestSeverity(vulns: Vulnerability[]): VulnerabilitySeverity {
  if (vulns.length === 0) return "low";
  return vulns.reduce((highest, v) =>
    getSeverityScore(v.severity) > getSeverityScore(highest)
      ? v.severity
      : highest,
    "low" as VulnerabilitySeverity
  );
}
