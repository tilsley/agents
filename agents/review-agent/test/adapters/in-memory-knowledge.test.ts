import { describe, expect, test } from "bun:test";
import { InMemoryKnowledgeAdapter } from "../../src/adapters/memory/in-memory-knowledge.adapter";

describe("InMemoryKnowledgeAdapter", () => {
  test("returns empty results for empty store", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    const results = await mem.search("test");
    expect(results).toHaveLength(0);
  });

  test("finds documents matching query", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    await mem.store([
      { id: "1", content: "How to fix null pointer errors", metadata: {} },
      { id: "2", content: "Database migration guide", metadata: {} },
    ]);

    const results = await mem.search("null pointer");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  test("respects limit option", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    await mem.store([
      { id: "1", content: "test document one", metadata: {} },
      { id: "2", content: "test document two", metadata: {} },
      { id: "3", content: "test document three", metadata: {} },
    ]);

    const results = await mem.search("test", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  test("store updates existing documents", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    await mem.store([{ id: "1", content: "original", metadata: {} }]);
    await mem.store([{ id: "1", content: "updated content", metadata: {} }]);

    expect(mem.getDocumentCount()).toBe(1);
    const results = await mem.search("updated");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("updated content");
  });

  test("filters by metadata", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    await mem.store([
      { id: "1", content: "test doc", metadata: { type: "lesson" } },
      { id: "2", content: "test doc", metadata: { type: "review" } },
    ]);

    const results = await mem.search("test", { filter: { type: "lesson" } });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  test("clear removes all documents", async () => {
    const mem = new InMemoryKnowledgeAdapter();
    await mem.store([{ id: "1", content: "test", metadata: {} }]);
    mem.clear();
    expect(mem.getDocumentCount()).toBe(0);
  });
});
