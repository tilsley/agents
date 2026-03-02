import { useState, useEffect, useRef } from "react";
import type { Run } from "../types";
import { parsePipelineStages } from "../types";
import { PipelineStages } from "./PipelineStages";
import { LogPanel } from "./LogPanel";
import { LessonsPanel } from "./LessonsPanel";

interface Props {
  run: Run;
  onRunUpdate: () => void;
}

export function RunDetail({ run, onRunUpdate }: Props) {
  const [logs, setLogs] = useState<string[]>(run.logs);
  const [status, setStatus] = useState(run.status);
  const [prNumber, setPrNumber] = useState(run.prNumber);
  const [prUrl, setPrUrl] = useState(run.prUrl);
  const [tab, setTab] = useState<"logs" | "lessons">("logs");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Reset state when switching runs
    setLogs(run.logs);
    setStatus(run.status);
    setPrNumber(run.prNumber);
    setPrUrl(run.prUrl);

    if (run.status !== "running") return;

    // Open SSE stream
    const es = new EventSource(`/api/runs/${run.id}/stream`);
    esRef.current = es;

    es.addEventListener("log", (e) => {
      const { line } = JSON.parse(e.data) as { line: string };
      setLogs((prev) => [...prev, line]);
    });

    es.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data) as {
        status: Run["status"];
        prNumber?: number;
        prUrl?: string;
      };
      setStatus(data.status);
      if (data.prNumber) setPrNumber(data.prNumber);
      if (data.prUrl) setPrUrl(data.prUrl);
      es.close();
      void onRunUpdate();
    });

    es.addEventListener("error", () => {
      setStatus("failed");
      es.close();
      void onRunUpdate();
    });

    return () => {
      es.close();
    };
  }, [run.id]);

  const stages = parsePipelineStages(logs);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div>
          <span style={{ fontWeight: 600 }}>{run.owner}/{run.repo}</span>
          <span
            style={{
              marginLeft: 10,
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 20,
              background:
                status === "running"
                  ? "rgba(210,153,34,0.15)"
                  : status === "completed"
                  ? "rgba(63,185,80,0.15)"
                  : "rgba(248,81,73,0.15)",
              color:
                status === "running"
                  ? "var(--yellow)"
                  : status === "completed"
                  ? "var(--green)"
                  : "var(--red)",
            }}
          >
            {status}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {new Date(run.startedAt).toLocaleString()}
        </div>
      </div>

      {/* Pipeline stages bar */}
      <PipelineStages stages={stages} prNumber={prNumber} prUrl={prUrl} />

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          paddingLeft: 20,
          flexShrink: 0,
        }}
      >
        {(["logs", "lessons"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px",
              background: "transparent",
              color: tab === t ? "var(--text)" : "var(--muted)",
              borderBottom: tab === t ? "2px solid var(--blue)" : "2px solid transparent",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "logs" ? (
          <LogPanel logs={logs} />
        ) : (
          <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
            <LessonsPanel repo={run.repo} />
          </div>
        )}
      </div>
    </div>
  );
}
