import { describe, expect, test } from "bun:test";
import {
  isBotPr,
  isFailedCheck,
  shouldProcess,
} from "../../src/domain/policies/review-policy";

describe("isBotPr", () => {
  test("matches exact bot username", () => {
    expect(isBotPr("my-bot[bot]", "my-bot[bot]")).toBe(true);
  });

  test("rejects different username", () => {
    expect(isBotPr("human-user", "my-bot[bot]")).toBe(false);
  });

  test("rejects partial match", () => {
    expect(isBotPr("my-bot", "my-bot[bot]")).toBe(false);
  });

  test("rejects empty author", () => {
    expect(isBotPr("", "my-bot[bot]")).toBe(false);
  });
});

describe("isFailedCheck", () => {
  test("returns true for failure", () => {
    expect(isFailedCheck("failure")).toBe(true);
  });

  test("returns true for timed_out", () => {
    expect(isFailedCheck("timed_out")).toBe(true);
  });

  test("returns false for success", () => {
    expect(isFailedCheck("success")).toBe(false);
  });

  test("returns false for neutral", () => {
    expect(isFailedCheck("neutral")).toBe(false);
  });

  test("returns false for cancelled", () => {
    expect(isFailedCheck("cancelled")).toBe(false);
  });

  test("returns false for skipped", () => {
    expect(isFailedCheck("skipped")).toBe(false);
  });

  test("returns false for null", () => {
    expect(isFailedCheck(null)).toBe(false);
  });
});

describe("shouldProcess", () => {
  const bot = "my-bot[bot]";

  test("processes bot PR with failed check", () => {
    expect(shouldProcess(bot, bot, "failure")).toBe(true);
  });

  test("processes bot PR with timed_out check", () => {
    expect(shouldProcess(bot, bot, "timed_out")).toBe(true);
  });

  test("skips non-bot PR with failed check", () => {
    expect(shouldProcess("human", bot, "failure")).toBe(false);
  });

  test("skips bot PR with successful check", () => {
    expect(shouldProcess(bot, bot, "success")).toBe(false);
  });

  test("skips non-bot PR with successful check", () => {
    expect(shouldProcess("human", bot, "success")).toBe(false);
  });

  test("skips bot PR with null conclusion", () => {
    expect(shouldProcess(bot, bot, null)).toBe(false);
  });
});
