# @tilsley/failure-analyst

Monitors CI failures, classifies them as code bugs or infra flakes, and routes accordingly.

## Role

The Failure Analyst receives `check_run.failed` events from the conductor, classifies each failure, and emits a `failure-analysis.completed` event with `FailureAnalysis[]` in the payload.

**Responsibilities:**

1. Filter check runs to failures (`conclusion === "failure" | "timed_out"`).
2. Run heuristics to produce an optional hint (4 unambiguous infra patterns).
3. Fetch annotations + logs from GitHub for every failed check.
4. Always call `ClassifierLlmPort` — the LLM makes the final classification, using the hint as context.
5. Downgrade LLM results with `confidence < 0.6` to `"unknown"`.
6. Apply retry policy: infra flakes are retried up to `maxRetries` (default 3); at limit, escalate.
7. Immediately execute retry actions via `GitHubPort.rerunCheckRun()`.
8. Emit `failure-analysis.completed` with full `FailureAnalysis[]` for downstream agents.

## Decision Matrix

| Category | Action |
|---|---|
| `infra_flake` + retries remaining | `retry` → `rerunCheckRun()` |
| `infra_flake` + at retry limit | `escalate` |
| `code_bug` | `route_to_fixer` |
| `unknown` | `skip` |

## Classification Approach

The LLM classifies every failure. Heuristics are a pre-pass that produces a **hint** injected into the LLM prompt — the LLM can confirm or override.

**Why not bypass the LLM on heuristic match?**
Patterns like `timeout` are ambiguous: a test suite timing out from a performance regression introduced in the PR looks identical to an infra flake. The LLM has the PR title, PR body, check output, and logs to tell them apart. The heuristic doesn't.

**Heuristic hint patterns** (infra flake, confidence 0.85):

| Pattern | Error type |
|---|---|
| `ETIMEDOUT \| ECONNRESET \| ECONNREFUSED` | `network_error` |
| `rate limit` | `rate_limit` |
| `socket hang up` | `socket_hangup` |
| `ENOMEM` | `oom` |

When matched, the LLM prompt includes:
> **Pattern hint:** regex matched `network_error` — suggests `infra_flake`. Confirm or override based on full context.

All other patterns (TypeErrors, assertion failures, compilation errors, timeouts) are intentionally left to the LLM — they have too many false-positive edge cases for regex to be reliable.

## Directory Structure

```
src/
├── domain/
│   ├── entities/
│   │   └── failure-analysis.ts      # FailureAnalysis, FailureDecision
│   ├── policies/
│   │   ├── classification-policy.ts # classifyByHeuristic(), mapCategoryToDecision(), LLM_CONFIDENCE_THRESHOLD
│   │   └── retry-policy.ts          # shouldEscalateRetry(count, max)
│   └── utils/
│       └── format-failure-report.ts # markdown report for logging/comments
├── application/
│   ├── ports/
│   │   ├── classifier-llm.port.ts   # ClassifierLlmPort: classifyFailures(contexts[]) → ClassificationResult[]
│   │   └── conductor.port.ts        # ConductorPort: emit(PipelineEvent)
│   └── use-cases/
│       └── analyze-failure.ts       # AnalyzeFailure — main use case
└── adapters/
    ├── llm/
    │   └── copilot-classifier.adapter.ts  # ChatCompletionPort → ClassifierLlmPort
    └── state/
        └── in-memory-retry-tracker.ts     # RetryTrackerPort — TTL-based retry count store

test/
├── domain/
│   ├── classification-policy.test.ts  (hints-only patterns + decision matrix)
│   ├── retry-policy.test.ts
│   └── format-failure-report.test.ts
├── use-cases/
│   └── analyze-failure.test.ts        (always-LLM behaviour, hint threading, retry/escalate paths)
└── adapters/
    ├── copilot-classifier.test.ts     (JSON parse, fallback, confidence clamping)
    └── in-memory-retry-tracker.test.ts
```

## Key Types

```ts
type FailureDecision = "retry" | "route_to_fixer" | "escalate" | "skip"

interface FailureAnalysis {
  checkRunId: number;
  checkName: string;
  category: FailureCategory;   // from @tilsley/shared
  decision: FailureDecision;
  signature: FailureSignature; // from @tilsley/shared
  reasoning: string;
}

interface ClassificationContext {
  checkName: string;
  checkRunId: number;
  checkOutput: string;
  checkLog: string;
  prTitle: string;
  prBody: string;
  heuristicHint?: { category: FailureCategory; errorType: string } | null;
}
```

## LLM Adapter

`CopilotClassifierAdapter` wraps `ChatCompletionPort`. Sends a single prompt for all failed checks in the batch. When a `heuristicHint` is present, it is prepended to that check's section in the prompt. Parses a JSON array response:

```json
[{"checkRunId": 1001, "category": "infra_flake", "errorType": "network_error", "errorPattern": "ETIMEDOUT", "confidence": 0.9, "reasoning": "..."}]
```

Falls back to `category: "unknown", confidence: 0` on parse failure — never throws.

## Retry Tracker

`InMemoryRetryTracker` stores retry counts with a TTL (default 1 hour). Keys are `owner/repo#prNumber:checkName:headSha`. Includes `dispose()` to clear the cleanup interval — important in tests.

## Tests

```bash
bun test --cwd agents/failure-analyst
```
