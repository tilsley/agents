# @tilsley/distiller

Post-merge summarization and corporate memory writer.

## Role

The Distiller receives the full context of a completed pipeline run, uses an LLM to extract actionable lessons, and persists the quality-filtered results to the RAG database.

**Responsibilities:**

1. Receive a `review.completed` event from the conductor (with full `PipelineSummary`).
2. Call `SummarizerLlmPort.summarize()` to extract raw `Lesson[]` from the pipeline context.
3. Filter: remove lessons with empty `problem` or `solution`.
4. Deduplicate: drop lessons where `problem + solution` keys collide (case-insensitive).
5. Quality-filter: remove lessons below minimum length and tag thresholds.
6. Format each lesson into a `RagDocument` with a stable hash-based ID.
7. Persist to `RagPort.upsert()`.
8. Emit `distillation.completed` with counts (stored / filtered).

## Lesson Lifecycle

```
LLM output (raw Lesson[])
    │
    ▼ shouldIncludeLesson()
    │  requires: non-empty problem, non-empty solution
    │
    ▼ deduplicateLessons()
    │  key = problem.lower() + "::" + solution.lower()
    │
    ▼ meetsQualityThreshold()
    │  problem.length ≥ 10, solution.length ≥ 10, tags.length ≥ 1
    │
    ▼ formatLessonForStorage()
    │  → RagDocument { id: "lesson-<hash>", content, metadata: { type, tags } }
    │
    ▼ RagPort.upsert(documents)
```

## Directory Structure

```
src/
├── domain/
│   ├── entities/
│   │   ├── pipeline-summary.ts      # PipelineSummary — full context for summarization
│   │   └── distillation-result.ts   # DistillationResult { lessons, storedCount, filteredCount }
│   ├── policies/
│   │   ├── summarization-policy.ts  # shouldIncludeLesson(), deduplicateLessons(), getIncludedContext()
│   │   └── quality-policy.ts        # meetsQualityThreshold(), getQualityScore()
│   └── utils/
│       └── format-lesson.ts         # formatLessonForStorage() → RagDocument, formatLessonSummary()
├── application/
│   ├── ports/
│   │   ├── summarizer-llm.port.ts   # SummarizerLlmPort: summarize(PipelineSummary) → Lesson[]
│   │   └── conductor.port.ts        # ConductorPort: emit(PipelineEvent)
│   └── use-cases/
│       └── distill-lessons.ts       # DistillLessons — main use case
└── adapters/
    └── llm/
        └── copilot-summarizer.adapter.ts  # ChatCompletionPort → SummarizerLlmPort

test/
├── domain/
│   ├── summarization-policy.test.ts (17 tests — include/dedup/context rules)
│   ├── quality-policy.test.ts       (9 tests — threshold + scoring)
│   └── format-lesson.test.ts        (10 tests — ID stability, metadata, summary)
├── use-cases/
│   └── distill-lessons.test.ts      (12 tests — filtering pipeline, event emission)
└── adapters/
    └── copilot-summarizer.test.ts   (5 tests — JSON parse, field defaults, message content)
```

## Key Types

```ts
interface PipelineSummary {
  pullRequest: PullRequest;
  headSha: string;
  failureSignatures: FailureSignature[];
  reviewScore: number;
  reviewDecision: string;
  reviewFeedback: string;
  diff: string;
  metadata: Record<string, unknown>;
}

interface DistillationResult {
  lessons: Lesson[];
  storedCount: number;
  filteredCount: number;
}
```

## Quality Policy

`meetsQualityThreshold()` minimum requirements:

| Field | Minimum |
|---|---|
| `problem` length | 10 characters |
| `solution` length | 10 characters |
| `tags` count | 1 tag |

`getQualityScore()` returns 0–100 and rewards: longer descriptions (≥30 chars), non-empty context/outcome, and 3+ tags.

## Summarization Policy

`getIncludedContext(reviewScore, failureCount)` returns a list of context sections the LLM prompt should include:
- Always: `pr_title`, `pr_body`, `diff_summary`
- If failures: `failure_signatures`, `failure_resolutions`
- If score < 80: `review_feedback`, `review_scores`

## LLM Adapter

`CopilotSummarizerAdapter` wraps `ChatCompletionPort`. Builds a user message from the `PipelineSummary` (PR info, CI failure signatures, review score/decision/feedback, truncated diff). Instructs the LLM to extract 1–5 actionable lessons per pipeline run, or return `[]` if nothing notable happened. Parses a JSON array:

```json
[{"problem": "...", "solution": "...", "context": "...", "outcome": "...", "tags": ["ci"], "metadata": {}}]
```

Returns `[]` on parse failure — never throws.

## Lesson ID Stability

`formatLessonForStorage()` generates a deterministic ID using a djb2-style hash of `problem + solution + context`. The same lesson content always produces the same `RagDocument.id`, which means `upsert()` will overwrite rather than duplicate on re-runs.

## Tests

```bash
bun test --cwd agents/distiller
```

51 tests across 5 files.
