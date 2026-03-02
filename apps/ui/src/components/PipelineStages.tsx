import type { Stage, StageStatus } from "../types";

interface Props {
  stages: Stage[];
  prNumber?: number;
  prUrl?: string;
}

const ICON: Record<StageStatus, string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  warn: "⚠",
  blocked: "✕",
};

const COLOR: Record<StageStatus, string> = {
  pending: "var(--muted)",
  running: "var(--yellow)",
  done: "var(--green)",
  warn: "var(--yellow)",
  blocked: "var(--red)",
};

export function PipelineStages({ stages, prNumber, prUrl }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        flexWrap: "wrap",
        padding: "16px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {stages.map((stage, i) => (
        <div key={stage.id} style={{ display: "flex", alignItems: "center" }}>
          <StageChip stage={stage} />
          {i < stages.length - 1 && (
            <span style={{ color: "var(--border)", margin: "0 4px", fontSize: 18 }}>
              →
            </span>
          )}
        </div>
      ))}

      {prNumber && prUrl && (
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: "auto",
            background: "var(--blue)",
            color: "#000",
            fontWeight: 600,
            borderRadius: 6,
            padding: "4px 12px",
            fontSize: 13,
          }}
        >
          View PR #{prNumber}
        </a>
      )}
    </div>
  );
}

function StageChip({ stage }: { stage: Stage }) {
  const color = COLOR[stage.status];
  const icon = ICON[stage.status];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minWidth: 64,
        padding: "4px 8px",
        borderRadius: 6,
        background: stage.status === "running" ? "rgba(210, 153, 34, 0.1)" : "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color, fontSize: 13, fontWeight: 600 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{stage.label}</span>
      </div>
      {stage.detail && (
        <span style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          {stage.detail}
        </span>
      )}
    </div>
  );
}
