# @tilsley/agents

A multi-agent CI/CD platform — autonomous agents that monitor, fix, review, and learn from pipeline events.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the system design and pipeline diagram.
See [`clean-arch.md`](clean-arch.md) for the architecture philosophy.

## Directory Layout

```
packages/shared/          @tilsley/shared — common entities, ports, types
apps/conductor/           @tilsley/conductor — pipeline orchestration
agents/reviewer-agent/    Legacy prototype (standalone, 107 tests)
agents/failure-analyst/   @tilsley/failure-analyst — CI failure classification
agents/review-agent/      @tilsley/review-agent — checklist-driven code review
agents/distiller/         @tilsley/distiller — post-merge summarization
```

## Quick Start

```bash
bun install          # install all workspace dependencies
bun test --recursive # run all tests across the monorepo
```

## Status

| Package | Source Files | Tests | Status |
|---|---|---|---|
| `reviewer-agent` | 21 | 107 | Operational (legacy prototype) |
| `@tilsley/shared` | 15 | 13 | Implemented |
| `@tilsley/conductor` | 11 | 74 | Implemented |
| `@tilsley/failure-analyst` | 9 | 61 | Implemented |
| `@tilsley/review-agent` | 11 | 62 | Implemented |
| `@tilsley/distiller` | 9 | 51 | Implemented |
| **Total** | **76** | **368** | |

## Pipeline Flow

```
GitHub webhook (check_run.completed)
        │
        ▼
   Conductor
   webhook.server.ts  ← Hono + @octokit/webhooks signature validation
        │ emit PipelineEvent
        ▼
InMemoryOrchestratorAdapter
        │ on("check_run.completed")
        ▼
   RouteEvent  ──────────────►  failure-analyst
                                 AnalyzeFailure
                                      │
                          ┌───────────┴──────────────┐
                          │                          │
                     heuristic match             no match
                     (20 regex patterns)          │
                          │                    ClassifierLlmPort
                          │                    (ChatCompletionPort)
                          └───────────┬──────────────┘
                                      │
                          category + confidence
                                      │
                     ┌────────────────┼──────────────┐
                     │                │              │
                 code_bug        infra_flake      unknown
                     │                │              │
              route_to_fixer    retry (+ track     skip
                                  InMemoryRetryTracker)
                                      │
                        emit("failure-analysis.completed")
                                      │
                                      ▼
                               review-agent
                                EvaluatePr
                                      │
                   KnowledgePort.findRelevantLessons()
                   KnowledgePort.findPastReviews()
                   (backed by MarkdownMemoryAdapter)
                                      │
                        ReviewerLlmPort.evaluateChecklist()
                        → ChecklistScore[] (weighted)
                                      │
                     calculateOverallScore() → 0–100
                     makeReviewDecision()
                                      │
                     advisory mode? ──┤
                     (forced request_ │
                      changes if CI   │
                      has code_bug    │
                      or escalate)    │
                                      │
                   ┌──────────────────┼──────────────────┐
                   │                  │                  │
                approve          escalate        request_changes
                approvePR()     commentPR()      requestChangesPR()
                   │
                   ▼
             emit("review.completed")
                   │
                   ▼
              distiller
            DistillLessons
                   │
        SummarizerLlmPort.summarize(PipelineSummary)
        → raw Lesson[]
                   │
        shouldIncludeLesson() — filters empty problem/solution
        deduplicateLessons()  — dedupes by problem+solution key
        meetsQualityThreshold() — min lengths, min tags
                   │
        formatLessonForStorage() → MemoryDocument (stable hash ID)
        MemoryPort.replace(documents)
                   │
                   ▼
             emit("distillation.completed")
```

## Key Design Decisions

**Agents are libraries, not servers.** The conductor is the sole HTTP server. Agents export use-case classes wired together by the conductor. This makes the entire pipeline testable without a running server.

**`InMemoryOrchestratorAdapter` now, Inngest later.** The `OrchestratorPort` interface (`emit`, `on`, `off`) supports a simple in-memory event bus for development and tests. The Inngest adapter is a straight swap with no domain changes — see the conductor README for the full research.

**Shared `ChatCompletionPort`.** All LLM adapters implement a single `ChatCompletionPort` (messages in, string out). Each agent wraps it in a domain-specific port with typed inputs and outputs:

| Agent | Domain-specific port | Output type |
|---|---|---|
| failure-analyst | `ClassifierLlmPort` | `ClassificationResult[]` |
| review-agent | `ReviewerLlmPort` | `ChecklistScore[]` |
| distiller | `SummarizerLlmPort` | `Lesson[]` |

**Lesson memory is file-based.** Lessons are persisted as markdown files via `MarkdownMemoryAdapter` (implements `MemoryPort`). The review agent loads relevant lessons at review time via `KnowledgePort` (backed by `InMemoryKnowledgeAdapter` in tests).

**Heuristic-first classification.** The failure analyst tries 20 regex patterns (ETIMEDOUT, TypeError, SyntaxError, rate limit, etc.) before calling the LLM. LLM results below `confidence < 0.6` are downgraded to `unknown`.

**`Result<T, E>` type.** The shared package provides a discriminated union result type (`ok(value)` / `err(error)`) for use cases that need to propagate errors without throwing.

**`correlationId` threads through all events.** Every `PipelineEvent` carries a `correlationId` in the format `owner/repo#prNumber:headSha`. This links all events in a pipeline run together for tracing.
