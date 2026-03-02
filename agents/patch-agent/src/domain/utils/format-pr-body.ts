import type { PatchPlan, PackageFix, SkippedFix, CheckResult } from "../entities/patch-plan";
import type { PatchAdvice } from "../../application/ports/patch-advisor-llm.port";

export function formatPrBody(plan: PatchPlan, owner: string, repo: string, checks?: CheckResult, advice?: PatchAdvice): string {
  const lines: string[] = [
    `## Security Patch`,
    ``,
    `Automated vulnerability fixes by **chore-bot/patch-agent** via Snyk.`,
    ``,
    `### Fixes`,
    ``,
  ];

  for (const fix of plan.fixes) {
    lines.push(formatFixSection(fix));
  }

  if (advice) {
    lines.push(...formatAdviceSection(advice));
  }

  if (plan.skipped.length > 0) {
    lines.push(`### ⛔ Skipped Fixes (${plan.skipped.length})`);
    lines.push(``);
    lines.push(`These fixes were rejected by the safety policy and were **not applied**:`);
    lines.push(``);
    for (const s of plan.skipped) {
      lines.push(`- **${s.fix.packageName}** \`${s.fix.fromVersion} → ${s.fix.toVersion}\` — ${s.reason}`);
    }
    lines.push(``);
  }

  if (plan.unfixable.length > 0) {
    lines.push(`### Unfixable Vulnerabilities (${plan.unfixable.length})`);
    lines.push(``);
    lines.push(`These require manual intervention (no upgrade path available):`);
    lines.push(``);
    for (const vuln of plan.unfixable) {
      const cves = vuln.cves.length > 0 ? ` (${vuln.cves.join(", ")})` : "";
      lines.push(
        `- **${vuln.packageName}@${vuln.installedVersion}** — ${vuln.severity}: ${vuln.title}${cves}`
      );
    }
    lines.push(``);
  }

  lines.push(...formatChecksSection(checks));
  lines.push(`---`);
  lines.push(`*Triggered by [chore-bot](https://github.com/apps/chore-bot) · [Snyk](https://snyk.io)*`);

  return lines.join("\n");
}

function formatFixSection(fix: PackageFix): string {
  const lines: string[] = [
    `#### \`${fix.packageName}\` ${fix.fromVersion} → ${fix.toVersion}`,
    ``,
  ];

  for (const vuln of fix.vulnerabilities) {
    const cves = vuln.cves.length > 0 ? ` · ${vuln.cves.join(", ")}` : "";
    lines.push(`- **[${vuln.severity.toUpperCase()}]** ${vuln.title}${cves}`);
  }

  lines.push(``);
  return lines.join("\n");
}

function formatAdviceSection(advice: PatchAdvice): string[] {
  const lines: string[] = [];

  if (advice.warnings.length > 0) {
    lines.push(`### ⚠️ Warnings`);
    lines.push(``);
    for (const w of advice.warnings) lines.push(`- ${w}`);
    lines.push(``);
  }

  if (advice.migrationNotes.length > 0) {
    lines.push(`### 📋 Migration Steps Required`);
    lines.push(``);
    for (const note of advice.migrationNotes) lines.push(`- [ ] ${note}`);
    lines.push(``);
  }

  if (advice.scopingRecommendation) {
    lines.push(`### 🔍 Scoping`);
    lines.push(``);
    lines.push(advice.scopingRecommendation);
    lines.push(``);
  }

  if (advice.riskLevel !== "low") {
    const emoji = advice.riskLevel === "high" ? "🔴" : "🟡";
    lines.push(`> ${emoji} **Risk level: ${advice.riskLevel.toUpperCase()}** — human review recommended before merging.`);
    lines.push(``);
  }

  return lines;
}

function formatChecksSection(checks?: CheckResult): string[] {
  if (!checks || checks.step === "none") return [];

  const lines: string[] = ["### Checks", ""];

  if (checks.success) {
    if (checks.step === "build") lines.push("✅ Build passed");
    if (checks.step === "test") {
      lines.push("✅ Build passed");
      lines.push("✅ Tests passed");
    }
  } else {
    if (checks.step === "build") {
      lines.push("❌ Build failed — manual review required");
    } else {
      lines.push("✅ Build passed");
      lines.push("❌ Tests failed — manual review required");
    }
    if (checks.output) {
      lines.push("");
      lines.push("<details>");
      lines.push("<summary>Output</summary>");
      lines.push("");
      lines.push("```");
      lines.push(checks.output);
      lines.push("```");
      lines.push("</details>");
    }
  }

  lines.push("");
  return lines;
}

export function formatCommitMessage(plan: PatchPlan): string {
  if (plan.fixes.length === 1) {
    const fix = plan.fixes[0];
    const cves = fix.vulnerabilities
      .flatMap((v) => v.cves)
      .slice(0, 3)
      .join(", ");
    const suffix = cves ? ` (${cves})` : "";
    return `fix(deps): patch ${fix.packageName} to ${fix.toVersion}${suffix}`;
  }

  const packages = plan.fixes.map((f) => `${f.packageName}@${f.toVersion}`).join(", ");
  return `fix(deps): patch vulnerable packages: ${packages}`;
}
