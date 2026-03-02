export interface EventBufferPort<T> {
  add(event: T, handler: (events: T[]) => Promise<void>): void;
  dispose(): void;
}
