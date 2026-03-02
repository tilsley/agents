import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import type { MemoryPort, MemoryDocument, MemoryQueryOptions } from "@tilsley/shared";

/**
 * Read-only MemoryPort backed by markdown files.
 * Uses the same path structure as the conductor's MarkdownMemoryAdapter:
 *   memory/{agent}/{repo}/lesson.md   (repo-specific)
 *   memory/{agent}/global/lesson.md   (universal)
 */
export class MarkdownMemoryReaderAdapter implements MemoryPort {
  constructor(private baseDir: string = "memory") {}

  async search(text: string, options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 10, filter = {} } = options;
    const file = this.filePathFor(filter);
    if (!existsSync(file)) return [];

    const stopWords = new Set(["with", "that", "this", "from", "have", "been", "will", "were", "they", "their"]);
    const tokens = text
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3 && !stopWords.has(t));

    if (tokens.length === 0) return [];

    const sections = this.parseSections(readFileSync(file, "utf-8"));
    return sections
      .filter((doc) => tokens.some((token) => doc.content.toLowerCase().includes(token)))
      .slice(0, limit);
  }

  async list(options: MemoryQueryOptions = {}): Promise<MemoryDocument[]> {
    const { limit = 100, filter = {} } = options;
    const file = this.filePathFor(filter);
    if (!existsSync(file)) return [];

    return this.parseSections(readFileSync(file, "utf-8")).slice(0, limit);
  }

  async store(_documents: MemoryDocument[]): Promise<void> {
    // Read-only — patch agent does not write to memory
  }

  async replace(_documents: MemoryDocument[], _filter: Record<string, unknown>): Promise<void> {
    // Read-only — patch agent does not write to memory
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
