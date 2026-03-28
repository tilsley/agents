import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { RepoTemplate } from "@tilsley/shared";

/**
 * Load a repo template from the policies directory.
 * Repo-specific template fully replaces global (no merging).
 */
export function loadRepoTemplate(
  policiesDir: string,
  repoSlug?: string
): RepoTemplate | null {
  // Repo-specific overrides global entirely
  if (repoSlug) {
    const repoPath = join(policiesDir, "repos", repoSlug, "repo-template.json");
    if (existsSync(repoPath)) {
      try {
        return JSON.parse(readFileSync(repoPath, "utf-8")) as RepoTemplate;
      } catch {
        /* invalid json — fall through to global */
      }
    }
  }

  // Fall back to global
  const globalPath = join(policiesDir, "global", "repo-template.json");
  if (existsSync(globalPath)) {
    try {
      return JSON.parse(readFileSync(globalPath, "utf-8")) as RepoTemplate;
    } catch {
      return null;
    }
  }

  return null;
}
