export interface PolicyRule {
  id: string;
  type: "documentation" | "upgrade-constraint" | "code-style";
  rule: string;
  source: {
    kind: "human-feedback" | "distiller" | "manual";
    repo?: string;
    prNumber?: number;
    date: string;
  };
  scope: "global" | "repo";
  repoSlug?: string;
  active: boolean;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}
