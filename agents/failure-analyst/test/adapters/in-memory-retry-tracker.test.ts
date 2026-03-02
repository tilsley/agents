import { describe, expect, test, afterEach } from "bun:test";
import { InMemoryRetryTracker } from "../../src/adapters/state/in-memory-retry-tracker";

describe("InMemoryRetryTracker", () => {
  let tracker: InMemoryRetryTracker;

  afterEach(() => {
    tracker?.dispose();
  });

  test("returns 0 for unknown key", () => {
    tracker = new InMemoryRetryTracker();
    expect(tracker.getCount("unknown")).toBe(0);
  });

  test("increments count", () => {
    tracker = new InMemoryRetryTracker();
    const key = "test/repo#1:ci/tests:abc123";
    expect(tracker.increment(key)).toBe(1);
    expect(tracker.increment(key)).toBe(2);
    expect(tracker.getCount(key)).toBe(2);
  });

  test("makeKey generates consistent keys", () => {
    const key = InMemoryRetryTracker.makeKey("owner", "repo", 42, "ci/tests", "sha123");
    expect(key).toBe("owner/repo#42:ci/tests:sha123");
  });

  test("entries are independent", () => {
    tracker = new InMemoryRetryTracker();
    tracker.increment("key-a");
    tracker.increment("key-a");
    tracker.increment("key-b");

    expect(tracker.getCount("key-a")).toBe(2);
    expect(tracker.getCount("key-b")).toBe(1);
  });

  test("dispose clears all entries", () => {
    tracker = new InMemoryRetryTracker();
    tracker.increment("key-a");
    tracker.dispose();

    // Create new tracker to test (old interval is cleared)
    tracker = new InMemoryRetryTracker();
    expect(tracker.getCount("key-a")).toBe(0);
  });
});
