# @tilsley/shared

Shared domain entities, application ports, and utility types for the multi-agent CI/CD platform.

## Purpose

This package is the common dependency for all agents and apps in the monorepo. It provides the stable interfaces that agents are written against, so each agent can be developed and tested independently while still speaking the same language at the boundaries.

## What's Exported

### Domain Entities

| Export | Description |
|---|---|
| `PullRequest` | `owner, repo, number, title, body, author` |
| `CheckRun` | `id, name, status, conclusion, headSha, output` |
| `CheckRunOutput` | `title, summary, text` (all nullable) |
| `FailureSignature` | `checkName, errorType, errorPattern, category, confidence` — structured CI failure descriptor |
| `FailureCategory` | `"code_bug" \| "infra_flake" \| "unknown"` |
| `ReviewChecklist` | `taskType, items: ChecklistItem[]` — task-specific review criteria |
| `ChecklistItem` | `id, label, description, weight` |
| `Lesson` | `problem, solution, context, outcome, tags, metadata` — structured lesson learned |
| `PipelineContext` | Full context of a pipeline run (PR, checks, signatures, diff, lessons) |

### Domain Utils

| Export | Description |
|---|---|
| `truncateLog(text, opts)` | Head+tail truncation for long CI logs. Defaults: 3000 chars, 33% head, 67% tail. |
| `TruncateLogOptions` | `maxLength?, headRatio?, separator?` |
| `detectLanguage(diff)` | Parses `diff --git` headers, tallies file-extension counts, returns the dominant language string or `null`. Supports: `typescript`, `javascript`, `java`, `kotlin`, `go`, `python`, `ruby`, `rust`, `csharp`, `cpp`, `c`, `php`, `swift`. |
| `ok(value)` | Constructs a `Result<T, never>` success value |
| `err(error)` | Constructs a `Result<never, E>` failure value |
| `Result<T, E>` | Discriminated union: `{ ok: true; value: T } \| { ok: false; error: E }` |

### Application Ports

| Port | Description |
|---|---|
| `GitHubPort` | Full GitHub operations interface: fetch PR, check runs, annotations, logs, rerun, close, diff, comment, approve, request-changes, merge |
| `ChatCompletionPort` | Low-level LLM abstraction: `complete(messages: ChatMessage[]) → string` |
| `ChatMessage` | `{ role: "system" \| "user" \| "assistant"; content: string }` |
| `EventBufferPort<T>` | Debounce buffer: `add(event, handler)` / `dispose()` |

### Types

| Export | Description |
|---|---|
| `PipelineEvent` | `{ type, payload, timestamp, correlationId }` — the event bus currency |
| `AgentTask` | `{ taskId, type, payload }` — what the conductor dispatches to agents |
| `AgentResult` | `{ taskId, status: "success" \| "failure" \| "skipped", output }` |

## Directory Structure

```
src/
├── index.ts                          # barrel export (all public API)
├── domain/
│   ├── entities/
│   │   ├── pull-request.ts
│   │   ├── check-run.ts
│   │   ├── failure-signature.ts
│   │   ├── review-checklist.ts
│   │   ├── lesson.ts
│   │   └── pipeline-context.ts
│   └── utils/
│       ├── truncate-log.ts
│       ├── detect-language.ts        # detectLanguage(diff) → dominant language or null
│       └── result.ts
├── application/
│   └── ports/
│       ├── github.port.ts
│       ├── llm.port.ts
│       └── event-buffer.port.ts
└── types/
    ├── pipeline-event.ts
    ├── agent-task.ts
    └── agent-result.ts

test/
└── domain/
    ├── truncate-log.test.ts      (7 tests)
    ├── result.test.ts            (6 tests)
    └── detect-language.test.ts   (11 tests)
```

## Tests

```bash
bun test packages/shared/
```

24 tests — `truncateLog` edge cases, `Result<T,E>` type narrowing, and `detectLanguage` coverage (per-language mapping, dominant-language selection, mixed diffs, null on no match).

## Migration Note

`agents/reviewer-agent/` predates this package and maintains its own copies of `PullRequest`, `CheckRun`, `GitHubPort`, `truncateLog`, and `EventBufferPort`. The new agents (`failure-analyst`, `review-agent`, `distiller`) depend on `@tilsley/shared` from day one. Migration of the legacy reviewer-agent is deferred until the new architecture is proven in production.
