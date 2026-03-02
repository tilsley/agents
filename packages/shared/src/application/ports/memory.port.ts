export interface MemoryDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface MemoryQueryOptions {
  limit?: number;
  filter?: Record<string, unknown>;
}

export interface MemoryPort {
  search(text: string, options?: MemoryQueryOptions): Promise<MemoryDocument[]>;
  list(options?: MemoryQueryOptions): Promise<MemoryDocument[]>;
  store(documents: MemoryDocument[]): Promise<void>;
  replace(documents: MemoryDocument[], filter: Record<string, unknown>): Promise<void>;
}
