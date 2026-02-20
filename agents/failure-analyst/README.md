# @tilsley/failure-analyst

Monitors CI failures, classifies them, and routes back to fixer or retries.

## Role

The Failure Analyst monitors CI/CD pipeline events and classifies check run failures.

**Responsibilities:**

1. Receive `check_run.completed` events where `conclusion` is `failure` or `timed_out`.
2. Analyze failure logs and annotations using an LLM.
3. Classify each failure as: **code bug** (caused by the PR's changes), **infra flake** (transient infrastructure issue), or **unknown**.
4. For infra flakes: signal the conductor to retry the check run.
5. For code bugs: signal the conductor to dispatch back to a fixer agent with failure context.
6. Log failure signatures (structured summaries) for the distiller to later consume.

## Key Domain Concepts

- **`FailureSignature`** entity — structured representation of a failure (check name, error type, error message pattern).
- **`ClassificationPolicy`** — rules for when to trust the LLM classification vs apply heuristic overrides.
- **`RetryPolicy`** — max retries, backoff, escalation rules.

## Relationship to reviewer-agent

The current `agents/reviewer-agent/` already has failure analysis logic in its `HandleCheckRunCompleted` use case and `CopilotAdapter.analyzeCheckFailure`. The failure-analyst agent will be a refactored, standalone version of this logic, designed to work within the conductor pipeline rather than as a standalone webhook handler.

## Directory Structure

```
src/
├── main.ts
├── domain/
│   ├── entities/        # FailureSignature, CheckRunResult
│   ├── policies/        # ClassificationPolicy, RetryPolicy
│   └── utils/
├── application/
│   ├── ports/           # LlmPort, GitHubPort, ConductorPort
│   └── use-cases/       # AnalyzeFailure, ClassifyAndRoute
└── adapters/            # LLM adapter, GitHub adapter
```
