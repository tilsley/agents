import { describe, expect, test } from "bun:test";
import { ok, err } from "../../src/domain/utils/result";
import type { Result } from "../../src/domain/utils/result";

describe("Result", () => {
  test("ok() creates a success result", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  test("err() creates a failure result", () => {
    const result = err(new Error("boom"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("boom");
    }
  });

  test("ok result can hold complex types", () => {
    const result = ok({ name: "test", items: [1, 2, 3] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("test");
      expect(result.value.items).toEqual([1, 2, 3]);
    }
  });

  test("err result can hold string errors", () => {
    const result: Result<number, string> = err("not found");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not found");
    }
  });

  test("type narrowing works with ok check", () => {
    const result: Result<string, Error> = ok("hello");
    if (result.ok) {
      const value: string = result.value;
      expect(value).toBe("hello");
    } else {
      throw new Error("should not reach here");
    }
  });

  test("type narrowing works with error check", () => {
    const result: Result<string, Error> = err(new Error("fail"));
    if (!result.ok) {
      const error: Error = result.error;
      expect(error.message).toBe("fail");
    } else {
      throw new Error("should not reach here");
    }
  });
});
