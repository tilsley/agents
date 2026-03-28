import type { DocClaim } from "../entities/doc-claim";

const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 200 * 1024; // 200KB

const ENTRY_POINTS = [
  "src/main.ts",
  "src/index.ts",
  "src/app.ts",
  "index.ts",
  "main.ts",
  "app.ts",
];

const NOTABLE_CONFIGS = [
  "Makefile",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env.example",
];

/**
 * Deterministic heuristic for selecting which source files the code analyzer should read.
 * Priority:
 *   1. Entry points (src/main.ts, etc.)
 *   2. package.json
 *   3. Files referenced in doc claims
 *   4. Notable config files (Dockerfile, CI workflows, .env.example)
 *   5. Top-level files in src/
 *
 * Capped at 20 files, 200KB total.
 */
export function selectFilesForAnalysis(
  allFiles: string[],
  claims: DocClaim[]
): string[] {
  const selected = new Set<string>();

  // 1. Entry points
  for (const entry of ENTRY_POINTS) {
    if (allFiles.includes(entry)) {
      selected.add(entry);
    }
  }

  // 2. package.json
  if (allFiles.includes("package.json")) {
    selected.add("package.json");
  }

  // 3. Files referenced in doc claims
  for (const claim of claims) {
    const refs = extractFileReferences(claim.sourceText);
    for (const ref of refs) {
      if (allFiles.includes(ref)) {
        selected.add(ref);
      }
    }
  }

  // 4. Notable config files + CI workflows
  for (const cfg of NOTABLE_CONFIGS) {
    if (allFiles.includes(cfg)) {
      selected.add(cfg);
    }
  }
  for (const f of allFiles) {
    if (f.startsWith(".github/workflows/")) {
      selected.add(f);
    }
  }

  // 5. Top-level files in src/
  for (const f of allFiles) {
    if (selected.size >= MAX_FILES) break;
    if (f.startsWith("src/") && !f.slice(4).includes("/") && f.endsWith(".ts")) {
      selected.add(f);
    }
  }

  // Enforce file cap
  const result = [...selected].slice(0, MAX_FILES);
  return result;
}

/**
 * After selecting files, enforce total size budget by dropping lowest-priority files.
 */
export function enforceByteLimit(
  files: Array<{ path: string; content: string }>
): Array<{ path: string; content: string }> {
  let totalBytes = 0;
  const kept: Array<{ path: string; content: string }> = [];

  for (const f of files) {
    const size = new TextEncoder().encode(f.content).byteLength;
    if (totalBytes + size > MAX_TOTAL_BYTES) break;
    totalBytes += size;
    kept.push(f);
  }

  return kept;
}

function extractFileReferences(text: string): string[] {
  const pattern = /`([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)`/g;
  const refs: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const ref = match[1];
    if (!ref.includes("://") && !ref.startsWith("http")) {
      refs.push(ref);
    }
  }

  return refs;
}
