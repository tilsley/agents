export interface RagDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface RagQueryOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
}

export interface RagPort {
  query(text: string, options?: RagQueryOptions): Promise<RagDocument[]>;
  upsert(documents: RagDocument[]): Promise<void>;
}
