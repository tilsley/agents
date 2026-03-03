/**
 * Extracts error-dense lines from a raw GitHub Actions log.
 *
 * GitHub Actions logs are large (often 100k+ chars of boilerplate: dependency
 * installation, environment setup, progress spinners). This function strips
 * timestamps, identifies lines that contain error signals, and returns those
 * lines with a small context window around each match — compact enough to fit
 * in an LLM prompt without losing the relevant information.
 *
 * If no error patterns match at all (e.g. the log is just setup output) the
 * last `maxLines` lines are returned on the assumption that errors appear near
 * the end of a CI run.
 */

const ERROR_PATTERNS: RegExp[] = [
  /##\[error\]/i,
  /\bERROR\b/,
  /\bFAIL(ED)?\b/,
  /Error:/,
  /TypeError|SyntaxError|ReferenceError|RangeError|AssertionError/,
  /\bat\s+\S+\s*\(/,                   // stack trace: "at Object.<anonymous> (src/..."
  /^\s*(Expected|Received):/m,         // Jest/Bun assertion diagnostics
  /expected\b.+\breceived\b/i,         // single-line assertion summary
  /\bAssert(ion)?\b.*\bfail/i,
  /✗|✘|×/,                             // common test failure symbols
  /npm ERR!/,                          // npm error lines (! is not a word char, skip \b)
  /Process completed with exit code [^0]/,
];

const JAVA_PATTERNS: RegExp[] = [
  /BUILD FAILURE/,
  /\[ERROR\]/,
  /COMPILATION ERROR/,
  /Caused by:/,
  /NullPointerException|ClassCastException|IllegalArgumentException|IllegalStateException|StackOverflowError|OutOfMemoryError/,
  /Tests run:.*(?:Failures|Errors): [^0]/,
];

const GO_PATTERNS: RegExp[] = [
  /^panic:/m,
  /--- FAIL:/,
  /^FAIL\t/m,
  /goroutine \d+ \[/,
  /undefined:/,
  /cannot find package/,
  /cannot use/,
  /does not implement/,
];

const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/;

export interface ExtractErrorLinesOptions {
  /** Max lines to include in output. Default: 60. */
  maxLines?: number;
  /** Lines of context to keep above each error line. Default: 4. */
  linesBefore?: number;
  /** Lines of context to keep below each error line. Default: 6. */
  linesAfter?: number;
  /** Programming language — enables language-specific error patterns. */
  language?: string | null;
}

export function extractErrorLines(
  rawLog: string,
  options: ExtractErrorLinesOptions = {}
): string {
  const { maxLines = 60, linesBefore = 4, linesAfter = 6, language } = options;

  if (!rawLog.trim()) return "";

  const languagePatterns =
    language === "java" ? JAVA_PATTERNS :
    language === "go"   ? GO_PATTERNS   : [];
  const allPatterns = [...ERROR_PATTERNS, ...languagePatterns];

  // Strip GitHub Actions timestamp prefix from every line
  const lines = rawLog.split("\n").map((l) => l.replace(TIMESTAMP_PREFIX, ""));

  // Find all lines that match at least one error pattern
  const errorIndices = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (allPatterns.some((p) => p.test(lines[i]))) {
      const from = Math.max(0, i - linesBefore);
      const to = Math.min(lines.length - 1, i + linesAfter);
      for (let j = from; j <= to; j++) errorIndices.add(j);
    }
  }

  // No matches — fall back to the tail (CI errors almost always appear at the end)
  if (errorIndices.size === 0) {
    return lines.slice(-maxLines).join("\n").trim();
  }

  const selected = [...errorIndices]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map((i) => lines[i]);

  return selected.join("\n").trim();
}
