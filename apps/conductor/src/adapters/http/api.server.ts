import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface Run {
  id: string;
  owner: string;
  repo: string;
  status: "running" | "completed" | "failed";
  logs: string[];
  prNumber?: number;
  prUrl?: string;
  startedAt: string;
  completedAt?: string;
}

const runs = new Map<string, Run>();

const MEMORY_BASE = "memory";
const PATCH_AGENT_MAIN = new URL(
  "../../../../agents/patch-agent/src/main.ts",
  // Resolve relative to repo root, two levels up from apps/conductor
  new URL("../../../../../../", import.meta.url)
).pathname;

export function createApiRouter(): Hono {
  const app = new Hono();

  // Trigger a new patch-agent run
  app.post("/api/runs", async (c) => {
    const body = await c.req.json<{ owner: string; repo: string }>();
    const { owner, repo } = body;

    if (!owner?.trim() || !repo?.trim()) {
      return c.json({ error: "owner and repo are required" }, 400);
    }

    const id = `run-${Date.now()}`;
    const run: Run = {
      id,
      owner,
      repo,
      status: "running",
      logs: [],
      startedAt: new Date().toISOString(),
    };
    runs.set(id, run);

    // Fire and forget — client streams progress via SSE
    void spawnPatchAgent(run);

    return c.json({ runId: id });
  });

  // List recent runs
  app.get("/api/runs", (c) => {
    const list = Array.from(runs.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
    return c.json(list);
  });

  // Get a single run
  app.get("/api/runs/:id", (c) => {
    const run = runs.get(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);
    return c.json(run);
  });

  // SSE stream — polls run.logs and emits new lines until complete
  app.get("/api/runs/:id/stream", (c) => {
    const run = runs.get(c.req.param("id"));
    if (!run) return c.json({ error: "Not found" }, 404);

    return streamSSE(c, async (stream) => {
      let cursor = 0;

      while (true) {
        const newLines = run.logs.slice(cursor);
        for (const line of newLines) {
          await stream.writeSSE({ event: "log", data: JSON.stringify({ line }) });
          cursor++;
        }

        if (run.status !== "running" && cursor >= run.logs.length) {
          await stream.writeSSE({
            event: "complete",
            data: JSON.stringify({
              status: run.status,
              prNumber: run.prNumber,
              prUrl: run.prUrl,
            }),
          });
          break;
        }

        await Bun.sleep(150);
      }
    });
  });

  // Read lesson file for a repo
  app.get("/api/memory/:repo", (c) => {
    const repo = c.req.param("repo");
    const file = join(MEMORY_BASE, "security-patch", repo, "lesson.md");
    if (!existsSync(file)) return c.json({ content: "" });
    return c.json({ content: readFileSync(file, "utf-8") });
  });

  // Write lesson file for a repo
  app.put("/api/memory/:repo", async (c) => {
    const repo = c.req.param("repo");
    const { content } = await c.req.json<{ content: string }>();
    const file = join(MEMORY_BASE, "security-patch", repo, "lesson.md");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content ?? "", "utf-8");
    return c.json({ ok: true });
  });

  return app;
}

async function spawnPatchAgent(run: Run): Promise<void> {
  const addLog = (line: string) => run.logs.push(line);

  try {
    const proc = Bun.spawn(["bun", "run", PATCH_AGENT_MAIN], {
      env: {
        ...process.env,
        TARGET_OWNER: run.owner,
        TARGET_REPO: run.repo,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const readLines = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) addLog(l);
      }
      if (buf.trim()) addLog(buf);
    };

    await Promise.all([readLines(proc.stdout), readLines(proc.stderr)]);
    await proc.exited;

    // Extract PR details from final log line
    const lastLine = run.logs.at(-1) ?? "";
    const prMatch = lastLine.match(/PR #(\d+): (https:\/\/\S+)/);
    if (prMatch) {
      run.prNumber = parseInt(prMatch[1]);
      run.prUrl = prMatch[2];
    }

    run.status = proc.exitCode === 0 ? "completed" : "failed";
  } catch (err) {
    addLog(`[api] Failed to spawn patch-agent: ${String(err)}`);
    run.status = "failed";
  }

  run.completedAt = new Date().toISOString();
}
