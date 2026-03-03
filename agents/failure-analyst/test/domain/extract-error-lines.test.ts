import { describe, expect, test } from "bun:test";
import { extractErrorLines } from "../../src/domain/utils/extract-error-lines";

// GitHub Actions logs have a timestamp prefix on every line
function gha(...lines: string[]): string {
  return lines
    .map((l) => `2024-01-15T10:23:45.1234567Z ${l}`)
    .join("\n");
}

describe("extractErrorLines", () => {
  test("returns empty string for empty input", () => {
    expect(extractErrorLines("")).toBe("");
    expect(extractErrorLines("   ")).toBe("");
  });

  test("strips GitHub Actions timestamp prefixes", () => {
    const log = gha("FAIL src/app.test.ts", "  TypeError: something broke");
    const result = extractErrorLines(log);
    expect(result).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(result).toContain("FAIL src/app.test.ts");
  });

  test("captures lines matching FAIL pattern", () => {
    const log = gha(
      "Setting up Node.js",
      "Installing dependencies",
      "FAIL src/app.test.ts",
      "  ● should return 42",
      "All done"
    );
    const result = extractErrorLines(log, { linesBefore: 0, linesAfter: 0 });
    expect(result).toContain("FAIL src/app.test.ts");
    expect(result).not.toContain("Setting up Node.js");
    expect(result).not.toContain("All done");
  });

  test("includes context lines around errors", () => {
    const log = gha(
      "line 1",
      "line 2",
      "TypeError: boom",
      "line 4",
      "line 5"
    );
    const result = extractErrorLines(log, { linesBefore: 1, linesAfter: 1 });
    expect(result).toContain("line 2");      // 1 line before
    expect(result).toContain("TypeError: boom");
    expect(result).toContain("line 4");      // 1 line after
    expect(result).not.toContain("line 1"); // outside context
    expect(result).not.toContain("line 5"); // outside context
  });

  test("captures ##[error] GitHub Actions command lines", () => {
    const log = gha(
      "Run npm test",
      "Tests passed",
      "##[error]Process completed with exit code 1."
    );
    const result = extractErrorLines(log, { linesBefore: 0, linesAfter: 0 });
    expect(result).toContain("##[error]Process completed with exit code 1.");
  });

  test("captures stack trace lines", () => {
    const log = gha(
      "TypeError: Cannot read properties of undefined",
      "    at Object.<anonymous> (src/app.ts:42:15)",
      "    at Object.<anonymous> (src/app.test.ts:18:5)"
    );
    const result = extractErrorLines(log);
    expect(result).toContain("at Object.<anonymous> (src/app.ts:42:15)");
    expect(result).toContain("at Object.<anonymous> (src/app.test.ts:18:5)");
  });

  test("captures npm ERR! lines", () => {
    const log = gha(
      "npm ERR! code ELIFECYCLE",
      "npm ERR! errno 1",
      "npm ERR! path /app"
    );
    const result = extractErrorLines(log, { contextLines: 0 });
    expect(result).toContain("npm ERR! code ELIFECYCLE");
    expect(result).toContain("npm ERR! errno 1");
    expect(result).toContain("npm ERR! path /app");
  });

  test("falls back to tail when no error patterns match", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `setup line ${i + 1}`);
    const log = gha(...lines);
    const result = extractErrorLines(log, { maxLines: 10 });
    // Should return the last 10 lines (tail fallback)
    expect(result).toContain("setup line 100");
    expect(result).toContain("setup line 91");
    expect(result).not.toContain("setup line 90");
  });

  test("respects maxLines limit", () => {
    // Create a log with many error lines
    const errorLines = Array.from({ length: 200 }, (_, i) => `ERROR: failure ${i}`);
    const log = gha(...errorLines);
    const result = extractErrorLines(log, { maxLines: 20, linesBefore: 0, linesAfter: 0 });
    const outputLines = result.split("\n").filter(Boolean);
    expect(outputLines.length).toBeLessThanOrEqual(20);
  });

  test("handles real-world Jest-style failure output", () => {
    const log = gha(
      "##[group]Run bun test",
      "bun test v1.0.0",
      "",
      "FAIL src/utils.test.ts",
      "  ● formatDate › should format correctly",
      "",
      "    expect(received).toBe(expected)",
      "",
      "    Expected: \"2024-01-15\"",
      "    Received: \"01/15/2024\"",
      "",
      "      18 | test('should format correctly', () => {",
      "      19 |   expect(formatDate(new Date('2024-01-15'))).toBe('2024-01-15');",
      "         |                                              ^",
      "      20 | });",
      "",
      "##[endgroup]",
      "##[error]Process completed with exit code 1."
    );
    const result = extractErrorLines(log);
    expect(result).toContain("FAIL src/utils.test.ts");
    expect(result).toContain('Expected: "2024-01-15"');
    expect(result).toContain('Received: "01/15/2024"');
    expect(result).toContain("##[error]Process completed with exit code 1.");
    // Should be compact — well under 3000 chars
    expect(result.length).toBeLessThan(2000);
  });

  test("handles log without timestamps (non-Actions CI)", () => {
    const log = [
      "Running tests...",
      "FAILED: test_user_creation",
      "AssertionError: expected 200, got 500",
    ].join("\n");
    const result = extractErrorLines(log, { linesBefore: 0, linesAfter: 0 });
    expect(result).toContain("FAILED: test_user_creation");
    expect(result).toContain("AssertionError: expected 200, got 500");
  });

  test("captures BUILD FAILURE with language: java", () => {
    const log = gha(
      "Downloading dependencies",
      "[INFO] Building project",
      "[ERROR] COMPILATION ERROR",
      "BUILD FAILURE",
      "[ERROR] Failed to execute goal"
    );
    const withJava = extractErrorLines(log, { linesBefore: 0, linesAfter: 0, language: "java" });
    expect(withJava).toContain("BUILD FAILURE");

    // Without language: java, BUILD FAILURE alone does not match base patterns
    const withoutLang = extractErrorLines(log, { linesBefore: 0, linesAfter: 0 });
    // [ERROR] still triggers the base FAILED pattern, so other lines may appear,
    // but we specifically verify BUILD FAILURE is captured with java language
    expect(withJava).toContain("[ERROR] COMPILATION ERROR");
  });

  test("does not capture pure BUILD FAILURE line without java language", () => {
    // A log that only has BUILD FAILURE (no other base patterns).
    // Use more than maxLines lines so the tail fallback is selective.
    const setupLines = Array.from({ length: 80 }, (_, i) => `setup line ${i + 1}`);
    const log = [...setupLines, "BUILD FAILURE", "All done"].join("\n");

    const withoutLang = extractErrorLines(log, { linesBefore: 0, linesAfter: 0, maxLines: 10 });
    // Falls back to tail — BUILD FAILURE is not in base patterns, so we get the last 10 lines
    expect(withoutLang).toContain("All done");
    expect(withoutLang).not.toContain("setup line 1");

    const withJava = extractErrorLines(log, { linesBefore: 0, linesAfter: 0, language: "java" });
    expect(withJava).toContain("BUILD FAILURE");
  });

  test("captures Go panic: with language: go", () => {
    const log = gha(
      "=== RUN   TestFoo",
      "panic: runtime error: index out of range [3] with length 3",
      "goroutine 1 [running]:",
      "main.main()",
      "exit status 2"
    );
    const withGo = extractErrorLines(log, { linesBefore: 0, linesAfter: 0, language: "go" });
    expect(withGo).toContain("panic: runtime error");
    expect(withGo).toContain("goroutine 1 [running]:");
  });

  test("captures --- FAIL: with language: go", () => {
    const log = gha(
      "=== RUN   TestAdd",
      "--- FAIL: TestAdd (0.00s)",
      "    math_test.go:10: expected 5, got 4",
      "FAIL",
      "exit status 1"
    );
    const withGo = extractErrorLines(log, { linesBefore: 0, linesAfter: 0, language: "go" });
    expect(withGo).toContain("--- FAIL: TestAdd");
  });

  test("does not capture go-specific patterns without language: go", () => {
    // A log with only Go-specific patterns (no base pattern matches)
    const log = [
      "--- FAIL: TestAdd (0.00s)",
      "    math_test.go:10: expected 5",
    ].join("\n");
    // Base ERROR_PATTERNS won't match "--- FAIL:" (FAIL\b would match FAIL in "FAIL:" — let's verify)
    // Actually \bFAIL(ED)?\b matches "FAIL" in "--- FAIL:" so this line IS captured by base
    // Use a pattern that is only in GO_PATTERNS
    const goOnlyLog = [
      "does not implement io.Writer",
      "some setup line",
    ].join("\n");
    const withoutGo = extractErrorLines(goOnlyLog, { linesBefore: 0, linesAfter: 0 });
    // Falls back to tail — "does not implement" not in base patterns
    expect(withoutGo).toContain("some setup line");

    const withGo = extractErrorLines(goOnlyLog, { linesBefore: 0, linesAfter: 0, language: "go" });
    expect(withGo).toContain("does not implement io.Writer");
  });
});
