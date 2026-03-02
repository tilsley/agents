import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import type { MemoryPort, MemoryDocument, MemoryQueryOptions } from "@tilsley/shared";

export class MarkdownMemoryAdapter implements MemoryPort {
  constructor(private baseDir: string = "memory") {
    mkdirSync(this.baseDir, { recursive: true });
  }

  async search(text: string, options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 10, filter = {} } = options;
    const file = this.filePathFor(filter);
    if (!existsSync(file)) return [];

    const content = readFileSync(file, "utf-8");
    const sections = this.parseSections(content);

    // Split into meaningful tokens (>3 chars, ignore stop words)
    const stopWords = new Set(["with", "that", "this", "from", "have", "been", "will", "were", "they", "their"]);
    const tokens = text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3 && !stopWords.has(t));

    if (tokens.length === 0) return [];

    return sections
      .filter((doc) => {
        const lower = doc.content.toLowerCase();
        return tokens.some((token) => lower.includes(token));
      })
      .slice(0, limit);
  }

  async list(options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 100, filter = {} } = options;
    const file = this.filePathFor(filter);
    if (!existsSync(file)) return [];

    const content = readFileSync(file, "utf-8");
    return this.parseSections(content).slice(0, limit);
  }

  async store(documents: MemoryDocument[]): Promise<void> {
    for (const doc of documents) {
      const file = this.filePathFor(doc.metadata);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, this.formatDocument(doc), "utf-8");
    }
  }

  async replace(documents: MemoryDocument[], filter: Record<string, unknown>): Promise<void> {
    const file = this.filePathFor(filter);
    mkdirSync(dirname(file), { recursive: true });
    const content = documents.map((doc) => this.formatDocument(doc)).join("");
    writeFileSync(file, content, "utf-8");
  }

  private filePathFor(metadata: Record<string, unknown>): string {
    const type = (metadata["type"] as string) ?? "general";
    const agent = metadata["agent"] as string | undefined;
    const repo = metadata["repo"] as string | undefined;
    const scope = metadata["scope"] as string | undefined;

    if (agent && scope === "global") {
      return join(this.baseDir, agent, "global", `${type}.md`);
    }
    if (agent && repo) {
      return join(this.baseDir, agent, repo, `${type}.md`);
    }
    return join(this.baseDir, `${type}.md`);
  }

  private formatDocument(doc: MemoryDocument): string {
    const date = new Date().toISOString().split("T")[0];
    return `\n## ${doc.id} — ${date}\n\n${doc.content}\n\n---\n`;
  }

  private parseSections(content: string): MemoryDocument[] {
    return content
      .split(/\n---\n/)
      .filter((s) => s.trim())
      .map((section) => {
        const idMatch = section.match(/^##\s+(.+?)\s+—/m);
        return {
          id: idMatch?.[1] ?? "unknown",
          content: section.trim(),
          metadata: {},
        };
      });
  }
}
