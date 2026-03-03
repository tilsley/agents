const EXT_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript",
  java: "java", kt: "kotlin",
  go: "go",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  cpp: "cpp", cc: "cpp", cxx: "cpp", c: "c",
  php: "php",
  swift: "swift",
};

/**
 * Detects the dominant programming language in a PR diff by tallying file
 * extensions from `diff --git` headers. Returns the language with the highest
 * count, or null if no recognised extensions are found.
 */
export function detectLanguage(diff: string): string | null {
  if (!diff.trim()) return null;

  const counts = new Map<string, number>();
  const headerRegex = /^diff --git a\/(.+) b\//gm;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(diff)) !== null) {
    const path = match[1];
    const ext = path.split(".").pop()?.toLowerCase();
    if (!ext) continue;
    const lang = EXT_MAP[ext];
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }

  if (counts.size === 0) return null;

  let dominant = "";
  let max = 0;
  for (const [lang, count] of counts) {
    if (count > max) {
      max = count;
      dominant = lang;
    }
  }

  return dominant;
}
