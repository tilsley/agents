import { useState } from "react";

type Agent = "patch" | "upgrade";

export type RunParams =
  | { agent: "patch"; owner: string; repo: string }
  | { agent: "upgrade"; owner: string; repo: string; packageName: string; toVersion: string };

interface Props {
  onRun: (params: RunParams) => Promise<void>;
}

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "7px 10px",
  color: "var(--text)",
  outline: "none",
  width: "100%",
};

export function RunForm({ onRun }: Props) {
  const [agent, setAgent] = useState<Agent>("patch");
  const [repo, setRepo] = useState("");
  const [packageName, setPackageName] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [loading, setLoading] = useState(false);

  const bothProvided = packageName.trim().length > 0 && toVersion.trim().length > 0;
  const bothEmpty = packageName.trim().length === 0 && toVersion.trim().length === 0;
  const isValid =
    repo.includes("/") &&
    (agent === "patch" || bothProvided || bothEmpty); // both blank = auto-discover

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const [owner, repoName] = repo.trim().split("/");
    if (!owner || !repoName) return;
    setLoading(true);
    try {
      if (agent === "patch") {
        await onRun({ agent: "patch", owner, repo: repoName });
      } else {
        await onRun({ agent: "upgrade", owner, repo: repoName, packageName, toVersion });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Agent selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
        {(["patch", "upgrade"] as Agent[]).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAgent(a)}
            style={{
              flex: 1,
              padding: "5px 0",
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 600,
              background: agent === a ? "var(--blue)" : "transparent",
              color: agent === a ? "#fff" : "var(--muted)",
              border: `1px solid ${agent === a ? "var(--blue)" : "var(--border)"}`,
              textTransform: "capitalize",
              cursor: "pointer",
            }}
          >
            {a}
          </button>
        ))}
      </div>

      <input
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        placeholder="owner/repo"
        disabled={loading}
        style={inputStyle}
      />

      {agent === "upgrade" && (
        <>
          <input
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="package name — leave blank to auto-discover"
            disabled={loading}
            style={inputStyle}
          />
          <input
            value={toVersion}
            onChange={(e) => setToVersion(e.target.value)}
            placeholder="target version — leave blank to auto-discover"
            disabled={loading}
            style={{ ...inputStyle, opacity: packageName.trim().length === 0 ? 0.5 : 1 }}
          />
          {bothEmpty && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -2 }}>
              LLM will pick the best outdated dependency to upgrade.
            </div>
          )}
        </>
      )}

      <button
        type="submit"
        disabled={loading || !isValid}
        style={{
          background: loading ? "var(--border)" : "var(--green)",
          color: loading ? "var(--muted)" : "#000",
          borderRadius: 6,
          padding: "7px 12px",
          fontWeight: 600,
          opacity: !isValid ? 0.5 : 1,
          cursor: isValid && !loading ? "pointer" : "default",
        }}
      >
        {loading ? "Starting…" : `Run ${agent}-agent`}
      </button>
    </form>
  );
}
