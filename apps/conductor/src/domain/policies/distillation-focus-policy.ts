import { PATCH_BOT_AUTHORS } from "./checklist-policy";

const SECURITY_PATCH_FOCUS =
  "Focus on dependency management lessons: semver monotonicity (version changes must be upgrades not downgrades), " +
  "PR scoping (one package or risk tier per PR), build validation before opening PRs, " +
  "migration requirements for major version bumps (config file renames, API changes, import path updates), " +
  "and CI environment prerequisites (generated files, toolchain version matching).";

export function getDistillationFocus(
  prAuthor: string,
  prTitle: string
): string | undefined {
  if (PATCH_BOT_AUTHORS.has(prAuthor)) {
    return SECURITY_PATCH_FOCUS;
  }

  const titleLower = prTitle.toLowerCase();
  if (titleLower.startsWith("chore:") || titleLower.startsWith("fix(deps)")) {
    return SECURITY_PATCH_FOCUS;
  }

  return undefined;
}
