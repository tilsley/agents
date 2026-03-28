import type { DriftItem } from "../entities/drift-report";
import type { PolicyRule } from "@tilsley/shared";
import { readmeText, parseReadme } from "../utils/parse-readme";

export interface RepoInventory {
  scripts: Record<string, string>;
  envVars: string[];
  configFiles: string[];
  allFiles: string[];
  readmeContent: string | null;
}

/**
 * Scripts that users typically need to know about.
 * Everything else (lint, format, typecheck, clean, etc.) is tooling noise.
 */
const USER_FACING_SCRIPTS = new Set([
  "start", "dev", "build", "test", "serve", "preview", "deploy",
]);

/**
 * Detects user-facing scripts in package.json that are not mentioned in the README.
 * Only flags scripts users need to run — skips tooling/lifecycle scripts.
 */
export function detectScriptDrift(inventory: RepoInventory): DriftItem[] {
  if (!inventory.readmeContent) return [];

  // Search raw content (lowercased) — scripts are often documented inside code blocks,
  // which readmeText() strips out.
  const raw = inventory.readmeContent.toLowerCase();
  const items: DriftItem[] = [];

  for (const [name, cmd] of Object.entries(inventory.scripts)) {
    if (!USER_FACING_SCRIPTS.has(name)) continue;

    // Word-boundary match to avoid "test" matching "latest" or "testing"
    const wordPattern = new RegExp(`\\b${escapeRegex(name)}\\b`);
    const mentioned =
      wordPattern.test(raw) ||
      raw.includes(`npm run ${name}`) ||
      raw.includes(`yarn ${name}`) ||
      raw.includes(`bun run ${name}`) ||
      raw.includes(`pnpm ${name}`);

    if (!mentioned) {
      items.push({
        file: "README.md",
        driftType: "undocumented-script",
        severity: "high",
        detail: `Script \`${name}\` (\`${cmd}\`) is not documented`,
        source: "deterministic",
      });
    }
  }

  return items;
}

/** Generic env vars that don't need documenting — everyone knows what these are. */
const GENERIC_ENV_VARS = new Set([
  "NODE_ENV", "PORT", "HOST", "TZ", "LANG", "HOME", "PATH", "DEBUG",
]);

/**
 * Detects env vars in .env.example that are not mentioned in the README.
 * Skips generic/obvious vars that don't need explanation.
 */
export function detectEnvVarDrift(inventory: RepoInventory): DriftItem[] {
  if (!inventory.readmeContent || inventory.envVars.length === 0) return [];

  // Search raw content — env vars are often documented in code blocks or tables
  const raw = inventory.readmeContent.toLowerCase();
  const items: DriftItem[] = [];

  for (const varName of inventory.envVars) {
    if (GENERIC_ENV_VARS.has(varName)) continue;

    if (!raw.includes(varName.toLowerCase())) {
      items.push({
        file: "README.md",
        driftType: "undocumented-env-var",
        severity: "high",
        detail: `Environment variable \`${varName}\` is not documented`,
        source: "deterministic",
      });
    }
  }

  return items;
}

/** Extensions that indicate a real file path (not a dotted identifier). */
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "rb", "java", "kt", "swift", "c", "cpp", "h",
  "json", "yml", "yaml", "toml", "xml", "csv",
  "md", "txt", "html", "css", "scss", "less",
  "sh", "bash", "zsh", "ps1",
  "sql", "graphql", "gql",
  "dockerfile", "lock", "env", "example",
]);

/**
 * Detects references in the README to files that don't exist.
 * Only flags things that look like actual file paths — requires either
 * a path separator or a known source-code extension.
 */
export function detectStaleReferences(inventory: RepoInventory): DriftItem[] {
  if (!inventory.readmeContent) return [];

  const items: DriftItem[] = [];
  const seen = new Set<string>();
  const fileSet = new Set(inventory.allFiles);

  // Strip fenced code blocks — refs inside ``` blocks are often example output, not real paths
  const contentOutsideCodeBlocks = inventory.readmeContent.replace(/```[\s\S]*?```/g, "");

  // Match backtick-wrapped references in prose
  const pathPattern = /`([a-zA-Z0-9_\-@./]+\.[a-zA-Z0-9]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(contentOutsideCodeBlocks)) !== null) {
    const ref = match[1];

    // Skip URLs
    if (ref.includes("://") || ref.startsWith("http")) continue;
    // Skip version strings (1.2.3)
    if (/^\d+\.\d+\.\d+$/.test(ref)) continue;
    // Skip .env variants (except .env.example which is a real file)
    if (ref.startsWith(".env") && ref !== ".env.example") continue;
    // Skip scoped npm packages (@scope/pkg.name)
    if (ref.startsWith("@")) continue;
    // Skip dotted identifiers (PascalCase.method, obj.property) — real paths have / or start with .
    if (!ref.includes("/") && !ref.startsWith(".")) {
      const ext = ref.split(".").pop()?.toLowerCase() ?? "";
      if (!FILE_EXTENSIONS.has(ext)) continue;
    }
    // Deduplicate
    if (seen.has(ref)) continue;
    seen.add(ref);

    if (!fileSet.has(ref) && !fileSet.has(`./${ref}`)) {
      items.push({
        file: "README.md",
        driftType: "stale-reference",
        severity: "low",
        detail: `Reference to \`${ref}\` but file does not exist`,
        source: "deterministic",
      });
    }
  }

  return items;
}

/**
 * Detects Docker/container setup that has no mention in the README.
 * Only checks for Docker presence (not individual CI workflow files — nobody lists those).
 */
export function detectUndocumentedConfigs(inventory: RepoInventory): DriftItem[] {
  if (!inventory.readmeContent) return [];

  const text = readmeText(inventory.readmeContent);
  const items: DriftItem[] = [];

  const hasDockerfile = inventory.configFiles.some((f) => f === "Dockerfile");
  const hasCompose = inventory.configFiles.some(
    (f) => f === "docker-compose.yml" || f === "docker-compose.yaml"
  );

  // Flag once if Docker exists but isn't mentioned at all
  if ((hasDockerfile || hasCompose) && !text.includes("docker")) {
    items.push({
      file: "README.md",
      driftType: "undocumented-config",
      severity: "medium",
      detail: `Repository has ${hasDockerfile ? "a Dockerfile" : ""}${hasDockerfile && hasCompose ? " and " : ""}${hasCompose ? "docker-compose" : ""} but Docker is not mentioned in documentation`,
      source: "deterministic",
    });
  }

  return items;
}

/**
 * Detects missing README or missing policy-required sections.
 */
export function detectMissingDocs(
  inventory: RepoInventory,
  policyRules: PolicyRule[]
): DriftItem[] {
  const items: DriftItem[] = [];

  if (!inventory.readmeContent) {
    items.push({
      file: "README.md",
      driftType: "missing-readme",
      severity: "high",
      detail: "No README.md found in repository",
      source: "deterministic",
    });
    return items;
  }

  const sections = parseReadme(inventory.readmeContent);
  const headings = sections.map((s) => s.heading.toLowerCase());

  // Check policy-required sections
  for (const rule of policyRules) {
    const sectionMatch = rule.rule.match(/must have (?:a |an )?["'](.+?)["'] section/i);
    if (sectionMatch) {
      const required = sectionMatch[1].toLowerCase();
      if (!headings.some((h) => h.includes(required))) {
        items.push({
          file: "README.md",
          driftType: "missing-section",
          severity: "medium",
          detail: `Policy requires a "${sectionMatch[1]}" section (rule: ${rule.id})`,
          source: "deterministic",
        });
      }
    }
  }

  // Default: check for common expected sections if repo has relevant files
  const defaults: Array<{ condition: boolean; section: string; label: string }> = [
    {
      condition: Object.keys(inventory.scripts).length > 0,
      section: "usage",
      label: "Usage/Getting Started",
    },
    {
      condition: inventory.envVars.length > 0,
      section: "environment",
      label: "Environment Variables",
    },
  ];

  for (const { condition, section, label } of defaults) {
    if (!condition) continue;
    const text = readmeText(inventory.readmeContent);
    const hasMention =
      headings.some((h) => h.includes(section)) ||
      text.includes(`## ${section}`) ||
      text.includes(`### ${section}`);

    if (!hasMention) {
      items.push({
        file: "README.md",
        driftType: "missing-section",
        severity: "low",
        detail: `No "${label}" section found — repo has relevant content to document`,
        source: "deterministic",
      });
    }
  }

  return items;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Run all drift detectors and return combined results.
 */
export function detectAllDrift(
  inventory: RepoInventory,
  policyRules: PolicyRule[]
): DriftItem[] {
  return [
    ...detectScriptDrift(inventory),
    ...detectEnvVarDrift(inventory),
    ...detectStaleReferences(inventory),
    ...detectUndocumentedConfigs(inventory),
    ...detectMissingDocs(inventory, policyRules),
  ];
}
