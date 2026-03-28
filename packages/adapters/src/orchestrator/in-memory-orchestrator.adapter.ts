import type { OrchestratorPort, EventHandler, PipelineEvent } from "@tilsley/shared";

export class InMemoryOrchestratorAdapter implements OrchestratorPort {
  private handlers = new Map<string, Set<EventHandler>>();

  async emit(event: PipelineEvent): Promise<void> {
    const handlers = this.handlers.get(event.type);
    if (!handlers || handlers.size === 0) return;
    await Promise.all(Array.from(handlers).map((h) => h(event)));
  }

  on(type: string, handler: EventHandler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }

  off(type: string, handler: EventHandler): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.handlers.delete(type);
    }
  }

  getHandlerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
