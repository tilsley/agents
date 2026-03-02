import { describe, expect, test } from "bun:test";
import { truncateLog } from "../../src/domain/utils/truncate-log";

describe("truncateLog", () => {
  test("returns short text unchanged", () => {
    const text = "short log output";
    expect(truncateLog(text, { maxLength: 3000 })).toBe(text);
  });

  test("returns text at exact limit unchanged", () => {
    const text = "x".repeat(3000);
    expect(truncateLog(text, { maxLength: 3000 })).toBe(text);
  });

  test("truncates with head+tail split", () => {
    const text = "A".repeat(1500) + "B".repeat(1500) + "C".repeat(1500);
    const result = truncateLog(text, { maxLength: 3000 });

    expect(result.length).toBeLessThanOrEqual(3000);
    expect(result).toContain("... [truncated] ...");
    expect(result.startsWith("A")).toBe(true);
    expect(result.endsWith("C")).toBe(true);
  });

  test("tail portion is larger than head by default", () => {
    const separator = "\n\n... [truncated] ...\n\n";
    const budget = 3000 - separator.length;
    const expectedHead = Math.floor(budget * 0.33);
    const expectedTail = budget - expectedHead;

    const text = "H".repeat(2000) + "T".repeat(2000);
    const result = truncateLog(text, { maxLength: 3000 });

    const parts = result.split(separator);
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBe(expectedHead);
    expect(parts[1].length).toBe(expectedTail);
  });

  test("preserves realistic error at end of log", () => {
    const preamble = "Installing dependencies...\n".repeat(200);
    const errorBlock =
      "ERROR: TypeError: Cannot read property 'id' of undefined\n" +
      "    at processUser (src/handler.ts:42:15)\n" +
      "    at Object.<anonymous> (test/handler.test.ts:18:5)";
    const text = preamble + errorBlock;

    const result = truncateLog(text, { maxLength: 3000 });

    expect(result).toContain("TypeError: Cannot read property 'id' of undefined");
    expect(result).toContain("processUser");
  });

  test("respects custom headRatio", () => {
    const separator = "\n\n... [truncated] ...\n\n";
    const text = "x".repeat(5000);
    const result = truncateLog(text, {
      maxLength: 3000,
      headRatio: 0.5,
    });

    const budget = 3000 - separator.length;
    const parts = result.split(separator);
    expect(parts[0].length).toBe(Math.floor(budget * 0.5));
  });

  test("respects custom separator", () => {
    const text = "x".repeat(5000);
    const result = truncateLog(text, {
      maxLength: 3000,
      separator: " ... ",
    });

    expect(result).toContain(" ... ");
    expect(result.length).toBeLessThanOrEqual(3000);
  });
});
