import type { MemoryPort, MemoryDocument, MemoryQueryOptions } from "@tilsley/shared";

export class InMemoryKnowledgeAdapter implements MemoryPort {
  private documents: MemoryDocument[] = [];

  async search(text: string, options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 10, filter = {} } = options;

    const lowerText = text.toLowerCase();
    const results = this.documents.filter((doc) => {
      const contentMatch = doc.content.toLowerCase().includes(lowerText);
      const metadataMatch = Object.entries(filter).every(
        ([key, value]) => doc.metadata[key] === value
      );
      return contentMatch && metadataMatch;
    });

    return results.slice(0, limit);
  }

  async list(options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 100, filter = {} } = options;
    return this.documents
      .filter((doc) =>
        Object.entries(filter).every(([k, v]) => doc.metadata[k] === v)
      )
      .slice(0, limit);
  }

  async store(documents: MemoryDocument[]): Promise<void> {
    for (const doc of documents) {
      const existingIndex = this.documents.findIndex((d) => d.id === doc.id);
      if (existingIndex >= 0) {
        this.documents[existingIndex] = doc;
      } else {
        this.documents.push(doc);
      }
    }
  }

  async replace(documents: MemoryDocument[], filter: Record<string, unknown>): Promise<void> {
    this.documents = [
      ...this.documents.filter((d) =>
        !Object.entries(filter).every(([k, v]) => d.metadata[k] === v)
      ),
      ...documents,
    ];
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  clear(): void {
    this.documents = [];
  }
}
