import { useState, useEffect } from "react";
import type { Run } from "./types";
import { RunForm } from "./components/RunForm";
import { RunDetail } from "./components/RunDetail";
import { RunHistory } from "./components/RunHistory";

export default function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const fetchRuns = async () => {
    const res = await fetch("/api/runs");
    if (res.ok) setRuns(await res.json());
  };

  useEffect(() => {
    void fetchRuns();
  }, []);

  const handleRun = async (owner: string, repo: string) => {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, repo }),
    });
    if (!res.ok) return;
    const { runId } = (await res.json()) as { runId: string };
    await fetchRuns();
    setActiveRunId(runId);
  };

  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 260,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Conductor
          </div>
          <RunForm onRun={handleRun} />
        </div>
        <RunHistory
          runs={runs}
          activeRunId={activeRun?.id ?? null}
          onSelect={setActiveRunId}
        />
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeRun ? (
          <RunDetail run={activeRun} onRunUpdate={fetchRuns} />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--muted)",
            }}
          >
            Enter a repo and click Run to start
          </div>
        )}
      </main>
    </div>
  );
}
