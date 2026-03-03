import { describe, expect, test } from "bun:test";
import { detectLanguage } from "../../src/domain/utils/detect-language";

function makeDiff(...files: string[]): string {
  return files
    .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new`)
    .join("\n");
}

describe("detectLanguage", () => {
  test("returns null for empty diff", () => {
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage("   ")).toBeNull();
  });

  test("returns null when no recognised extensions", () => {
    const diff = makeDiff("README.md", "Makefile", "config.yaml");
    expect(detectLanguage(diff)).toBeNull();
  });

  test("detects java from .java files", () => {
    const diff = makeDiff("src/Main.java", "src/Service.java");
    expect(detectLanguage(diff)).toBe("java");
  });

  test("detects go from .go files", () => {
    const diff = makeDiff("main.go", "handler.go");
    expect(detectLanguage(diff)).toBe("go");
  });

  test("detects typescript from .ts files", () => {
    const diff = makeDiff("src/index.ts", "src/utils.ts");
    expect(detectLanguage(diff)).toBe("typescript");
  });

  test("detects typescript from .tsx files", () => {
    const diff = makeDiff("components/App.tsx");
    expect(detectLanguage(diff)).toBe("typescript");
  });

  test("returns dominant language when mixed — more java than ts", () => {
    const diff = makeDiff(
      "src/Main.java",
      "src/Service.java",
      "src/Repo.java",
      "scripts/setup.ts"
    );
    expect(detectLanguage(diff)).toBe("java");
  });

  test("returns dominant language when mixed — more ts than java", () => {
    const diff = makeDiff(
      "src/index.ts",
      "src/utils.ts",
      "src/types.ts",
      "src/Helper.java"
    );
    expect(detectLanguage(diff)).toBe("typescript");
  });

  test("detects python from .py files", () => {
    const diff = makeDiff("app/main.py", "app/utils.py");
    expect(detectLanguage(diff)).toBe("python");
  });

  test("detects rust from .rs files", () => {
    const diff = makeDiff("src/main.rs");
    expect(detectLanguage(diff)).toBe("rust");
  });

  test("handles diff with no file extension", () => {
    const diff = "diff --git a/Makefile b/Makefile\n--- a/Makefile\n+++ b/Makefile";
    expect(detectLanguage(diff)).toBeNull();
  });
});
