# @tilsley/review-agent

Checklist-driven code review with RAG-powered corporate memory.

## Role

The Review Agent evaluates pull requests against a task-specific checklist, augmenting the LLM's judgement with relevant lessons from past pipeline runs stored in the RAG database.

**Responsibilities:**

1. Receive a `failure-analysis.completed` (or direct review task) event from the conductor.
2. Fetch the PR diff via `GitHubPort`.
3. Query `CorporateMemoryPort` for relevant past lessons and past reviews of the same task type.
4. Score each checklist item via `ReviewerLlmPort`, weighted by item importance.
5. Calculate an overall weighted score and apply decision thresholds.
6. Post the review via `GitHubPort` (approve / request_changes / comment for escalate).
7. Emit `review.completed` with the full `ReviewResult`.

## Decision Thresholds

Default thresholds (configurable per instance):

| Score | Decision |
|---|---|
| ≥ 80 | `approve` → `approvePullRequest()` |
| 41–79 | `escalate` → `commentOnPullRequest()` |
| ≤ 40 | `request_changes` → `requestChangesOnPullRequest()` |

## Directory Structure

```
src/
├── domain/
│   ├── entities/
│   │   ├── review-result.ts         # ReviewResult, ChecklistScore, ReviewDecision
│   │   └── review-context.ts        # ReviewContext — aggregated inputs for a review
│   ├── policies/
│   │   ├── review-policy.ts         # makeReviewDecision(), calculateOverallScore()
│   │   └── relevance-policy.ts      # filterByRelevance(), hasMinimumContext()
│   └── utils/
│       └── format-review-comment.ts # formatReviewComment(), formatScoreSummary()
├── application/
│   ├── ports/
│   │   ├── reviewer-llm.port.ts     # ReviewerLlmPort: evaluateChecklist(context) → ChecklistScore[]
│   │   ├── corporate-memory.port.ts # CorporateMemoryPort: findRelevantLessons(), findPastReviews()
│   │   └── conductor.port.ts        # ConductorPort: emit(PipelineEvent)
│   └── use-cases/
│       └── evaluate-pr.ts           # EvaluatePr — main use case
└── adapters/
    ├── llm/
    │   └── copilot-reviewer.adapter.ts   # ChatCompletionPort → ReviewerLlmPort
    └── rag/
        └── in-memory-rag.adapter.ts      # RagPort (text search, for tests)

test/
├── domain/
│   ├── review-policy.test.ts          (16 tests — thresholds, weighted scoring)
│   ├── relevance-policy.test.ts       (8 tests — filtering, metadata fallback)
│   └── format-review-comment.test.ts  (9 tests — all three decision states)
├── use-cases/
│   └── evaluate-pr.test.ts            (15 tests — full happy/sad paths)
└── adapters/
    ├── copilot-reviewer.test.ts        (5 tests)
    └── in-memory-rag.test.ts           (6 tests — upsert, query, filter, clear)
```

## Key Types

```ts
type ReviewDecision = "approve" | "request_changes" | "escalate"

interface ReviewResult {
  checklistScores: ChecklistScore[];
  overallScore: number;            // weighted average, 0–100
  decision: ReviewDecision;
  feedback: string;                // bullet points for low-scoring items
}

interface ChecklistScore {
  itemId: string;
  label: string;
  score: number;   // 0–100
  reasoning: string;
}
```

## LLM Adapter

`CopilotReviewerAdapter` wraps `ChatCompletionPort`. Builds a user message containing the PR title, description, truncated diff (8000 char limit), checklist items with weights, and any relevant lessons. Parses a JSON array response:

```json
[{"itemId": "quality", "label": "Code Quality", "score": 85, "reasoning": "..."}]
```

Falls back to score 50 for all checklist items on parse failure — never throws.

## RAG Adapter

`InMemoryRagAdapter` implements `RagPort` for tests. Stores documents in memory, queries by substring match, supports metadata filtering, and calculates a `relevanceScore: 0.8` for matching documents. Use `rag.clear()` between tests.

## CorporateMemory Port

`CorporateMemoryPort` sits on top of `RagPort`:

```ts
interface CorporateMemoryPort {
  findRelevantLessons(query: string, taskType: string): Promise<Lesson[]>
  findPastReviews(repo: string, taskType: string): Promise<string[]>
}
```

The real implementation will query the RAG database with semantic search. In tests, use a mock.

## Scoring

`calculateOverallScore()` computes a weighted mean of checklist item scores, rounded to the nearest integer. Item weights come from `checklist.items[n].weight`. Zero total weight returns 0.

## Tests

```bash
bun test --cwd agents/review-agent
```

57 tests across 6 files.
