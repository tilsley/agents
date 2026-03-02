import type { ReviewChecklist } from "@tilsley/shared";

// Known automated patch bot usernames
export const PATCH_BOT_AUTHORS = new Set([
  "chore-bot",
  "dependabot[bot]",
  "renovate[bot]",
  "renovate",
  "snyk-bot",
]);

export const DEFAULT_CHECKLIST: ReviewChecklist = {
  taskType: "general",
  items: [
    {
      id: "correctness",
      label: "Correctness",
      description: "The changes correctly solve the stated problem without introducing regressions",
      weight: 3,
    },
    {
      id: "tests",
      label: "Test Coverage",
      description: "Adequate tests are added or updated to cover the changes",
      weight: 2,
    },
    {
      id: "security",
      label: "Security",
      description: "No security vulnerabilities are introduced (injection, auth bypass, secrets exposure)",
      weight: 3,
    },
    {
      id: "clarity",
      label: "Code Clarity",
      description: "The code is readable, well-named, and easy to reason about",
      weight: 1,
    },
    {
      id: "breaking-changes",
      label: "Breaking Changes",
      description: "No unintended breaking changes to existing public APIs or contracts",
      weight: 2,
    },
  ],
};

export const SECURITY_PATCH_CHECKLIST: ReviewChecklist = {
  taskType: "security-patch",
  items: [
    {
      id: "build-passes",
      label: "Build Passes",
      description: "The changes compile and build successfully with no broken imports or missing modules. A failing build means the security fix cannot be deployed.",
      weight: 3,
    },
    {
      id: "semver-safety",
      label: "Semver Safety",
      description: "All version changes are upgrades not downgrades. Major version bumps are accompanied by the required migration steps (config changes, API updates, import path changes).",
      weight: 3,
    },
    {
      id: "scope",
      label: "PR Scope",
      description: "The PR is scoped to a single package or risk tier. Critical CVEs with breaking API changes should not be bundled with routine patch-level bumps.",
      weight: 2,
    },
    {
      id: "cve-coverage",
      label: "CVE Coverage",
      description: "The version changes actually address the stated CVEs. Version numbers in the description match what is in package.json. No future-dated or suspicious CVE references.",
      weight: 2,
    },
    {
      id: "breaking-changes",
      label: "Breaking Changes",
      description: "Any breaking API changes introduced by major version bumps are identified and handled in the same PR. The application code is updated to match the new API.",
      weight: 3,
    },
  ],
};

export function getChecklist(prAuthor: string, prTitle: string): ReviewChecklist {
  if (PATCH_BOT_AUTHORS.has(prAuthor)) {
    return SECURITY_PATCH_CHECKLIST;
  }

  const titleLower = prTitle.toLowerCase();
  if (titleLower.startsWith("chore:") || titleLower.startsWith("fix(deps)")) {
    return SECURITY_PATCH_CHECKLIST;
  }

  return DEFAULT_CHECKLIST;
}
