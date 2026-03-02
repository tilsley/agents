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

export type StageStatus = "pending" | "running" | "done" | "warn" | "blocked";

export interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
}

export function parsePipelineStages(logs: string[]): Stage[] {
  const text = logs.join("\n");

  const has = (pattern: RegExp) => pattern.test(text);

  const cloneDone = has(/\[patch-agent\] Cloned /);
  const scanDone = has(/Found \d+ fixable|is clean|Vulnerabilities found but none/);
  const planDone = scanDone; // plan runs immediately after scan
  const adviseDone = has(/Loaded \d+ lesson/);
  const applyDone = has(/Running checks|nothing to apply|All candidate fixes/);
  const prDone = has(/Opened PR #\d+/);

  // Detail strings
  const scanDetail = (() => {
    const m = text.match(/Found (\d+) fixable/);
    if (m) return `${m[1]} vulns`;
    if (has(/is clean/)) return "clean";
    if (has(/Vulnerabilities found but none/)) return "none fixable";
    return undefined;
  })();

  const planDetail = (() => {
    const skips = [...text.matchAll(/Skipped (.+?): /g)].length;
    return skips > 0 ? `${skips} skipped` : undefined;
  })();

  const adviseDetail = (() => {
    const m = text.match(/Loaded (\d+) lesson/);
    const deferred = [...text.matchAll(/Deferred .+ — /g)].length;
    const lessons = m ? `${m[1]} lessons` : "";
    const defer = deferred > 0 ? `${deferred} deferred` : "";
    return [lessons, defer].filter(Boolean).join(", ") || undefined;
  })();

  const checksDetail = (() => {
    if (has(/Checks passed/)) return "passed";
    if (has(/Checks failed/)) return "failed";
    return undefined;
  })();

  const prDetail = (() => {
    const m = text.match(/Opened PR #(\d+): (.+)/);
    return m ? `#${m[1]}` : undefined;
  })();

  // Determine the current running stage
  const activeIndex = [cloneDone, scanDone, adviseDone, applyDone, prDone].lastIndexOf(true) + 1;

  const stageStatus = (doneFlag: boolean, index: number): StageStatus => {
    if (doneFlag) return "done";
    if (index === activeIndex) return "running";
    return "pending";
  };

  return [
    {
      id: "clone",
      label: "Clone",
      status: stageStatus(cloneDone, 0),
    },
    {
      id: "scan",
      label: "Scan",
      status: stageStatus(scanDone, 1),
      detail: scanDetail,
    },
    {
      id: "plan",
      label: "Plan",
      status: planDone
        ? has(/All candidate fixes were skipped/)
          ? "blocked"
          : planDetail
          ? "warn"
          : "done"
        : stageStatus(false, 2),
      detail: planDetail,
    },
    {
      id: "advise",
      label: "Advise",
      status: adviseDone
        ? has(/All remaining fixes deferred/)
          ? "blocked"
          : has(/Deferred /)
          ? "warn"
          : "done"
        : stageStatus(false, 3),
      detail: adviseDetail,
    },
    {
      id: "apply",
      label: "Apply",
      status: applyDone
        ? has(/Checks failed/)
          ? "warn"
          : "done"
        : stageStatus(false, 4),
      detail: checksDetail,
    },
    {
      id: "pr",
      label: "PR",
      status: prDone ? "done" : stageStatus(false, 5),
      detail: prDetail,
    },
  ];
}
