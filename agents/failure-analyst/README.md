# @tilsley/failure-analyst

Monitors CI failures, classifies them as code bugs or infra flakes, and routes accordingly.

## Role

The Failure Analyst receives `check_run.completed` events from the conductor, classifies each failure, and emits a `failure-analysis.completed` event with `FailureAnalysis[]` in the payload.

**Responsibilities:**

1. Filter check runs to failures (`conclusion === "failure" | "timed_out"`).
2. Try heuristic classification first (20 regex patterns — no LLM call if matched).
3. For unclassified checks: fetch annotations + logs from GitHub, call `ClassifierLlmPort`.
4. Downgrade LLM results with `confidence < 0.6` to `"unknown"`.
5. Apply retry policy: infra flakes are retried up to `maxRetries` (default 3); at limit, escalate.
6. Immediately execute retry actions via `GitHubPort.rerunCheckRun()`.
7. Emit `failure-analysis.completed` with full `FailureAnalysis[]` for downstream agents.

## Decision Matrix

| Category | Action |
|---|---|
| `infra_flake` + retries remaining | `retry` → `rerunCheckRun()` |
| `infra_flake` + at retry limit | `escalate` |
| `code_bug` | `route_to_fixer` |
| `unknown` | `skip` |

## Heuristic Patterns

Checked before any LLM call. Flake patterns take priority over bug patterns.

**Infra flakes** (confidence 0.8):
`ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`, `rate limit`, `timeout / timed out`, `socket hang up`, `ENOMEM / out of memory`, `Resource temporarily unavailable`, `flaky / non-deterministic / intermittent`

**Code bugs** (confidence 0.7):
`SyntaxError / TypeError / ReferenceError`, `compilation error`, `cannot find module / missing import`, `type '...' is not assignable`, `expected ... but received`

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
│   ├── classification-policy.test.ts  (26 tests — all heuristic patterns + decision matrix)
│   ├── retry-policy.test.ts           (5 tests)
│   └── format-failure-report.test.ts  (7 tests)
├── use-cases/
│   └── analyze-failure.test.ts        (15 tests — happy/sad paths, mixed heuristic+LLM)
└── adapters/
    ├── copilot-classifier.test.ts     (5 tests — JSON parse, fallback, confidence clamping)
    └── in-memory-retry-tracker.test.ts (5 tests)
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
```

## LLM Adapter

`CopilotClassifierAdapter` wraps `ChatCompletionPort`. Sends a single prompt for all unclassified checks in the batch. Parses a JSON array response:

```json
[{"checkRunId": 1001, "category": "infra_flake", "errorType": "timeout", "errorPattern": "ETIMEDOUT", "confidence": 0.85, "reasoning": "..."}]
```

Falls back to `category: "unknown", confidence: 0` on parse failure — never throws.

## Retry Tracker

`InMemoryRetryTracker` stores retry counts with a TTL (default 1 hour). Keys are `owner/repo#prNumber:checkName:headSha`. Includes `dispose()` to clear the cleanup interval — important in tests.

## Tests

```bash
bun test --cwd agents/failure-analyst
```

61 tests across 6 files.
