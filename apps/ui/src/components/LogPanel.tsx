import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
}

function colorLine(line: string): string {
  if (line.includes("⚠️") || line.includes("Skipped") || line.includes("Checks failed"))
    return "var(--yellow)";
  if (line.includes("Deferred") || line.includes("nothing to apply") || line.includes("Risk level: HIGH"))
    return "var(--red)";
  if (line.includes("Opened PR") || line.includes("Checks passed") || line.includes("is clean"))
    return "var(--green)";
  if (line.includes("📋") || line.includes("🔍"))
    return "var(--purple)";
  if (line.includes("[api]"))
    return "var(--red)";
  return "var(--text)";
}

export function LogPanel({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {logs.length === 0 ? (
        <div style={{ color: "var(--muted)" }}>Waiting for output…</div>
      ) : (
        logs.map((line, i) => (
          <div key={i} style={{ color: colorLine(line), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {line}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
