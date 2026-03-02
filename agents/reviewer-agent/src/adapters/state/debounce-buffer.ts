import type { EventBufferPort } from "../../application/ports/event-buffer.port";

interface HasCheckRunHeadSha {
  checkRun: { headSha: string };
}

interface BufferEntry<T> {
  events: T[];
  timer: ReturnType<typeof setTimeout>;
  handler: (events: T[]) => Promise<void>;
}

export class DebounceBuffer<T extends HasCheckRunHeadSha>
  implements EventBufferPort<T>
{
  private buffers = new Map<string, BufferEntry<T>>();

  constructor(private windowMs: number = 5000) {}

  private getKey(event: T): string {
    return event.checkRun.headSha;
  }

  add(
    event: T,
    handler: (events: T[]) => Promise<void>
  ): void {
    const key = this.getKey(event);
    const existing = this.buffers.get(key);

    if (existing) {
      // Sliding window: clear old timer, add event, set new timer
      clearTimeout(existing.timer);
      existing.events.push(event);
      existing.timer = setTimeout(() => this.flush(key), this.windowMs);
    } else {
      const timer = setTimeout(() => this.flush(key), this.windowMs);
      this.buffers.set(key, { events: [event], timer, handler });
    }
  }

  dispose(): void {
    for (const [, entry] of this.buffers) {
      clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }

  private flush(key: string): void {
    const entry = this.buffers.get(key);
    if (!entry) return;

    this.buffers.delete(key);
    entry.handler(entry.events).catch((err) => {
      console.error(`[debounce] Error flushing buffer for ${key}:`, err);
    });
  }
}
