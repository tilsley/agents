import { describe, expect, test, mock } from "bun:test";
import { DebounceBuffer } from "../../src/adapters/state/debounce-buffer";
import type { CheckRunEvent } from "../../src/application/use-cases/handle-check-run-completed";

function makeEvent(overrides: { headSha?: string; id?: number; name?: string } = {}): CheckRunEvent {
  return {
    owner: "test-org",
    repo: "test-repo",
    checkRun: {
      id: overrides.id ?? 1001,
      name: overrides.name ?? "ci/tests",
      status: "completed",
      conclusion: "failure",
      headSha: overrides.headSha ?? "sha-123",
      output: { title: "Failed", summary: "Error", text: null },
    },
  };
}

describe("DebounceBuffer", () => {
  test("single event fires after window", async () => {
    const buffer = new DebounceBuffer(50);
    const handler = mock(() => Promise.resolve());

    buffer.add(makeEvent(), handler);

    // Not yet fired
    expect(handler).not.toHaveBeenCalled();

    // Wait for window to expire
    await Bun.sleep(80);

    expect(handler).toHaveBeenCalledTimes(1);
    const events = handler.mock.calls[0][0] as CheckRunEvent[];
    expect(events).toHaveLength(1);

    buffer.dispose();
  });

  test("multiple same-SHA events are batched", async () => {
    const buffer = new DebounceBuffer(50);
    const handler = mock(() => Promise.resolve());

    buffer.add(makeEvent({ headSha: "sha-A", id: 1, name: "ci/tests" }), handler);
    buffer.add(makeEvent({ headSha: "sha-A", id: 2, name: "ci/lint" }), handler);
    buffer.add(makeEvent({ headSha: "sha-A", id: 3, name: "ci/build" }), handler);

    await Bun.sleep(80);

    expect(handler).toHaveBeenCalledTimes(1);
    const events = handler.mock.calls[0][0] as CheckRunEvent[];
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.checkRun.id)).toEqual([1, 2, 3]);

    buffer.dispose();
  });

  test("different SHAs are processed independently", async () => {
    const buffer = new DebounceBuffer(50);
    const handler = mock(() => Promise.resolve());

    buffer.add(makeEvent({ headSha: "sha-A", id: 1 }), handler);
    buffer.add(makeEvent({ headSha: "sha-B", id: 2 }), handler);

    await Bun.sleep(80);

    expect(handler).toHaveBeenCalledTimes(2);

    buffer.dispose();
  });

  test("sliding window resets on new event", async () => {
    const buffer = new DebounceBuffer(100);
    const handler = mock(() => Promise.resolve());

    buffer.add(makeEvent({ headSha: "sha-A", id: 1 }), handler);

    // Add another event after 60ms, resetting the window
    await Bun.sleep(60);
    buffer.add(makeEvent({ headSha: "sha-A", id: 2 }), handler);

    // At 100ms from start (40ms after second add), should NOT have fired yet
    await Bun.sleep(30);
    expect(handler).not.toHaveBeenCalled();

    // At 160ms from start (100ms after second add), should have fired
    await Bun.sleep(80);
    expect(handler).toHaveBeenCalledTimes(1);
    const events = handler.mock.calls[0][0] as CheckRunEvent[];
    expect(events).toHaveLength(2);

    buffer.dispose();
  });

  test("dispose cancels pending timers", async () => {
    const buffer = new DebounceBuffer(50);
    const handler = mock(() => Promise.resolve());

    buffer.add(makeEvent(), handler);
    buffer.dispose();

    await Bun.sleep(80);

    expect(handler).not.toHaveBeenCalled();
  });
});
