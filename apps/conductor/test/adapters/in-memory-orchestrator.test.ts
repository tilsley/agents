import { describe, expect, test, mock } from "bun:test";
import { InMemoryOrchestratorAdapter } from "../../src/adapters/orchestrator/in-memory-orchestrator.adapter";
import type { PipelineEvent } from "@tilsley/shared";

function makeEvent(type: string = "test.event"): PipelineEvent {
  return {
    type,
    payload: { data: "test" },
    timestamp: new Date(),
    correlationId: "corr-1",
  };
}

describe("InMemoryOrchestratorAdapter", () => {
  test("emit calls registered handler", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler = mock(() => Promise.resolve());

    orchestrator.on("test.event", handler);
    await orchestrator.emit(makeEvent());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: "test.event" }));
  });

  test("emit does nothing without handlers", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    // Should not throw
    await orchestrator.emit(makeEvent());
  });

  test("supports multiple handlers for same event type", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler1 = mock(() => Promise.resolve());
    const handler2 = mock(() => Promise.resolve());

    orchestrator.on("test.event", handler1);
    orchestrator.on("test.event", handler2);
    await orchestrator.emit(makeEvent());

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  test("handlers for different event types are independent", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler1 = mock(() => Promise.resolve());
    const handler2 = mock(() => Promise.resolve());

    orchestrator.on("event.a", handler1);
    orchestrator.on("event.b", handler2);
    await orchestrator.emit(makeEvent("event.a"));

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });

  test("off removes a specific handler", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler = mock(() => Promise.resolve());

    orchestrator.on("test.event", handler);
    orchestrator.off("test.event", handler);
    await orchestrator.emit(makeEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  test("off only removes the specified handler", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler1 = mock(() => Promise.resolve());
    const handler2 = mock(() => Promise.resolve());

    orchestrator.on("test.event", handler1);
    orchestrator.on("test.event", handler2);
    orchestrator.off("test.event", handler1);
    await orchestrator.emit(makeEvent());

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  test("off does not throw for unregistered handler", () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler = mock(() => Promise.resolve());

    // Should not throw
    orchestrator.off("test.event", handler);
  });

  test("getHandlerCount returns correct count", () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    expect(orchestrator.getHandlerCount("test.event")).toBe(0);

    const handler = mock(() => Promise.resolve());
    orchestrator.on("test.event", handler);
    expect(orchestrator.getHandlerCount("test.event")).toBe(1);
  });

  test("clear removes all handlers", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const handler = mock(() => Promise.resolve());

    orchestrator.on("event.a", handler);
    orchestrator.on("event.b", handler);
    orchestrator.clear();

    await orchestrator.emit(makeEvent("event.a"));
    await orchestrator.emit(makeEvent("event.b"));

    expect(handler).not.toHaveBeenCalled();
  });

  test("all handlers run concurrently", async () => {
    const orchestrator = new InMemoryOrchestratorAdapter();
    const order: number[] = [];

    orchestrator.on("test.event", async () => {
      order.push(1);
    });
    orchestrator.on("test.event", async () => {
      order.push(2);
    });

    await orchestrator.emit(makeEvent());

    expect(order).toHaveLength(2);
    expect(order).toContain(1);
    expect(order).toContain(2);
  });
});
