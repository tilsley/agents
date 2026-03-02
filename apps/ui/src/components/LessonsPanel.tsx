import { useState, useEffect } from "react";

interface Props {
  repo: string;
}

export function LessonsPanel({ repo }: Props) {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/memory/${encodeURIComponent(repo)}`)
      .then((r) => r.json())
      .then((d: { content: string }) => {
        setContent(d.content);
        setSaved(true);
      })
      .finally(() => setLoading(false));
  }, [repo]);

  const save = async () => {
    await fetch(`/api/memory/${encodeURIComponent(repo)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaved(true);
  };

  if (loading) {
    return <div style={{ color: "var(--muted)", fontSize: 13, padding: 4 }}>Loading…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          memory/security-patch/{repo}/lesson.md
        </span>
        <button
          onClick={save}
          disabled={saved}
          style={{
            background: saved ? "transparent" : "var(--blue)",
            color: saved ? "var(--muted)" : "#000",
            borderRadius: 5,
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: 600,
            border: saved ? "1px solid var(--border)" : "none",
          }}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setSaved(false); }}
        placeholder="No lessons yet for this repo."
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "10px 12px",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          lineHeight: 1.6,
          resize: "vertical",
          minHeight: 160,
          outline: "none",
          width: "100%",
        }}
      />
    </div>
  );
}
