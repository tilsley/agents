import { describe, expect, test, beforeEach } from "bun:test";
import { InMemoryRerunTracker } from "../../src/adapters/state/in-memory-rerun-tracker";

describe("InMemoryRerunTracker", () => {
  let tracker: InMemoryRerunTracker;

  beforeEach(() => {
    tracker = new InMemoryRerunTracker(60_000);
  });

  test("returns 0 for unknown keys", () => {
    expect(tracker.getCount("unknown")).toBe(0);
    tracker.dispose();
  });

  test("increments and returns updated count", () => {
    const key = "org/repo#1:ci/tests:sha123";
    expect(tracker.increment(key)).toBe(1);
    expect(tracker.increment(key)).toBe(2);
    expect(tracker.increment(key)).toBe(3);
    expect(tracker.getCount(key)).toBe(3);
    tracker.dispose();
  });

  test("tracks independent keys separately", () => {
    const key1 = "org/repo#1:ci/tests:sha1";
    const key2 = "org/repo#1:ci/lint:sha1";

    tracker.increment(key1);
    tracker.increment(key1);
    tracker.increment(key2);

    expect(tracker.getCount(key1)).toBe(2);
    expect(tracker.getCount(key2)).toBe(1);
    tracker.dispose();
  });

  test("expires entries after TTL", () => {
    const shortTtl = new InMemoryRerunTracker(50); // 50ms TTL
    const key = "org/repo#1:ci/tests:sha1";

    shortTtl.increment(key);
    expect(shortTtl.getCount(key)).toBe(1);

    // Wait for TTL to expire
    const start = Date.now();
    while (Date.now() - start < 60) {
      // busy wait
    }

    expect(shortTtl.getCount(key)).toBe(0);
    shortTtl.dispose();
  });

  test("re-initializes count after TTL expiry on increment", () => {
    const shortTtl = new InMemoryRerunTracker(50);
    const key = "org/repo#1:ci/tests:sha1";

    shortTtl.increment(key);
    shortTtl.increment(key);
    expect(shortTtl.getCount(key)).toBe(2);

    const start = Date.now();
    while (Date.now() - start < 60) {
      // busy wait
    }

    // After expiry, increment starts fresh
    expect(shortTtl.increment(key)).toBe(1);
    shortTtl.dispose();
  });

  test("makeKey produces expected format", () => {
    const key = InMemoryRerunTracker.makeKey(
      "myorg",
      "myrepo",
      42,
      "ci/tests",
      "abc123"
    );
    expect(key).toBe("myorg/myrepo#42:ci/tests:abc123");
  });

  test("dispose clears state", () => {
    const key = "org/repo#1:ci/tests:sha1";
    tracker.increment(key);
    tracker.dispose();
    // After dispose, a new check returns 0 (internal map cleared)
    expect(tracker.getCount(key)).toBe(0);
  });
});
