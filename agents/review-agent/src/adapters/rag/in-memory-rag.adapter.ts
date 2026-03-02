import type { RagPort, RagDocument, RagQueryOptions } from "@tilsley/shared";

export class InMemoryRagAdapter implements RagPort {
  private documents: RagDocument[] = [];

  async query(text: string, options: RagQueryOptions = {}): Promise<RagDocument[]> {
    const { limit = 10, threshold = 0, filter = {} } = options;

    let results = this.documents.filter((doc) => {
      // Simple text matching for in-memory implementation
      const contentMatch = doc.content
        .toLowerCase()
        .includes(text.toLowerCase());
      const metadataMatch = Object.entries(filter).every(
        ([key, value]) => doc.metadata[key] === value
      );
      return contentMatch && metadataMatch;
    });

    // Add relevance score metadata
    results = results.map((doc) => ({
      ...doc,
      metadata: {
        ...doc.metadata,
        relevanceScore: doc.content.toLowerCase().includes(text.toLowerCase())
          ? 0.8
          : 0.2,
      },
    }));

    return results.slice(0, limit);
  }

  async upsert(documents: RagDocument[]): Promise<void> {
    for (const doc of documents) {
      const existingIndex = this.documents.findIndex((d) => d.id === doc.id);
      if (existingIndex >= 0) {
        this.documents[existingIndex] = doc;
      } else {
        this.documents.push(doc);
      }
    }
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  clear(): void {
    this.documents = [];
  }
}
