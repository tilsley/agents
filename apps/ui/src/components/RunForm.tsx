import { useState } from "react";

interface Props {
  onRun: (owner: string, repo: string) => Promise<void>;
}

export function RunForm({ onRun }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [owner, repo] = value.trim().split("/");
    if (!owner || !repo) return;
    setLoading(true);
    try {
      await onRun(owner, repo);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="owner/repo"
        disabled={loading}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "7px 10px",
          color: "var(--text)",
          outline: "none",
          width: "100%",
        }}
      />
      <button
        type="submit"
        disabled={loading || !value.includes("/")}
        style={{
          background: loading ? "var(--border)" : "var(--green)",
          color: loading ? "var(--muted)" : "#000",
          borderRadius: 6,
          padding: "7px 12px",
          fontWeight: 600,
          opacity: !value.includes("/") ? 0.5 : 1,
        }}
      >
        {loading ? "Starting…" : "Run patch-agent"}
      </button>
    </form>
  );
}
