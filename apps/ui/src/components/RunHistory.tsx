import type { Run } from "../types";

interface Props {
  runs: Run[];
  activeRunId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_DOT: Record<Run["status"], { color: string; label: string }> = {
  running: { color: "var(--yellow)", label: "●" },
  completed: { color: "var(--green)", label: "●" },
  failed: { color: "var(--red)", label: "●" },
};

export function RunHistory({ runs, activeRunId, onSelect }: Props) {
  if (runs.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>
        No runs yet
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {runs.map((run) => {
        const dot = STATUS_DOT[run.status];
        const isActive = run.id === activeRunId;
        const time = new Date(run.startedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return (
          <button
            key={run.id}
            onClick={() => onSelect(run.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              width: "100%",
              padding: "8px 16px",
              background: isActive ? "var(--surface)" : "transparent",
              borderLeft: isActive
                ? "2px solid var(--blue)"
                : "2px solid transparent",
              textAlign: "left",
              color: "var(--text)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: dot.color, fontSize: 10 }}>{dot.label}</span>
              <span style={{ fontWeight: 500, fontSize: 13 }}>
                {run.owner}/{run.repo}
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11, paddingLeft: 16 }}>
              {time}
            </div>
          </button>
        );
      })}
    </div>
  );
}
