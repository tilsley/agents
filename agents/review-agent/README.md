# @tilsley/review-agent

Checklist-driven code review with lesson memory.

## Role

The Review Agent evaluates pull requests against a task-specific checklist, augmenting the LLM's judgement with relevant lessons from past pipeline runs stored in the lesson store.

**Responsibilities:**

1. Receive a `failure-analysis.completed` (or direct review task) event from the conductor.
2. Fetch the PR diff via `GitHubPort`.
3. Query `KnowledgePort` for relevant past lessons and past reviews of the same task type.
4. Score each checklist item via `ReviewerLlmPort`, weighted by item importance.
5. Calculate an overall weighted score and apply decision thresholds.
6. If running in **advisory mode** (CI has a genuine failure), override the decision to `request_changes` regardless of score.
7. Post the review via `GitHubPort` (approve / request_changes / comment for escalate).
8. Emit `review.completed` with the full `ReviewResult`.

## Decision Thresholds

Default thresholds (configurable per instance):

| Score | Decision |
|---|---|
| ≥ 80 | `approve` → `approvePullRequest()` |
| 41–79 | `escalate` → `commentOnPullRequest()` |
| ≤ 40 | `request_changes` → `requestChangesOnPullRequest()` |

## Advisory Mode

When the conductor detects a genuine CI failure (e.g. `route_to_fixer` or `escalate` decision from the failure analyst), it tells the review agent to run in **advisory mode**. In this mode:

- The decision is forced to `request_changes` regardless of the code quality score.
- A blockquote banner is prepended to the GitHub comment explaining why.
- Code quality feedback is still provided for reference.

This prevents the review agent from approving a PR that has a known CI failure. The override happens post-LLM in the use-case layer — the LLM prompt and scoring are unchanged.

## Directory Structure

```
src/
├── domain/
│   ├── entities/
│   │   ├── review-result.ts         # ReviewResult, ChecklistScore, ReviewDecision, ReviewMode
│   │   └── review-context.ts        # ReviewContext — aggregated inputs for a review
│   ├── policies/
│   │   ├── review-policy.ts         # makeReviewDecision(), calculateOverallScore()
│   │   └── relevance-policy.ts      # filterByRelevance(), hasMinimumContext()
│   └── utils/
│       └── format-review-comment.ts # formatReviewComment(), formatScoreSummary()
├── application/
│   ├── ports/
│   │   ├── reviewer-llm.port.ts     # ReviewerLlmPort: evaluateChecklist(context) → ChecklistScore[]
│   │   ├── knowledge.port.ts        # KnowledgePort: findRelevantLessons(), findPastReviews()
│   │   └── conductor.port.ts        # ConductorPort: emit(PipelineEvent)
│   └── use-cases/
│       └── evaluate-pr.ts           # EvaluatePr — main use case
└── adapters/
    ├── llm/
    │   └── copilot-reviewer.adapter.ts   # ChatCompletionPort → ReviewerLlmPort
    └── memory/
        └── in-memory-knowledge.adapter.ts # KnowledgePort (text search, for tests)

test/
├── domain/
│   ├── review-policy.test.ts          (16 tests — thresholds, weighted scoring)
│   ├── relevance-policy.test.ts       (8 tests — filtering, metadata fallback)
│   └── format-review-comment.test.ts  (9 tests — decision states, advisory banner)
├── use-cases/
│   └── evaluate-pr.test.ts            (15 tests — happy/sad paths, advisory mode)
└── adapters/
    ├── copilot-reviewer.test.ts        (5 tests)
    └── in-memory-knowledge.test.ts     (6 tests — store, search, filter, clear)
```

## Key Types

```ts
type ReviewDecision = "approve" | "request_changes" | "escalate"
type ReviewMode = "advisory" | "full"

interface ReviewResult {
  checklistScores: ChecklistScore[];
  overallScore: number;            // weighted average, 0–100
  decision: ReviewDecision;
  feedback: string;                // bullet points for low-scoring items
  mode: ReviewMode;                // "advisory" forces request_changes
  advisoryReason?: string;         // why advisory mode was triggered
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

## Knowledge Port

`KnowledgePort` provides access to lessons and past reviews, backed by `MemoryPort` (markdown files in production, `InMemoryKnowledgeAdapter` in tests):

```ts
interface KnowledgePort {
  findRelevantLessons(query: string, taskType: string): Promise<Lesson[]>
  findPastReviews(repo: string, taskType: string): Promise<string[]>
}
```

## Scoring

`calculateOverallScore()` computes a weighted mean of checklist item scores, rounded to the nearest integer. Item weights come from `checklist.items[n].weight`. Zero total weight returns 0.

## Tests

```bash
bun test --cwd agents/review-agent
```

62 tests across 6 files.
