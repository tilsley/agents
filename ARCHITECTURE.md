# Architecture

A multi-agent CI/CD platform where autonomous agents monitor, fix, review, and learn from pipeline events in a continuous feedback loop.

## Pipeline

```
Fixer Agent(s)
    │
    │ creates PR
    v
CI/CD Runs ──────────► Failure Analyst
                            │
              ┌─────────────┼─────────────┐
              │             │             │
         code bug      infra flake    unknown
              │             │             │
              v             v             v
         Fixer Agent    Retry CI     Escalate
              │
              │ pushes fix
              v
         CI Passes ──────► Review Agent
                               │
                    ┌──────────┼──────────┐
                    │          │          │
                 approve   changes    escalate
                    │       needed       │
                    v          │         v
                  Merge     Fixer     Human
                    │
                    v
              Distiller Agent
                    │
                    v
              RAG Database (lessons learned)
                    │
                    └──────► feeds back into future agent decisions
```

## Agents

### Fixer Agents

Specialized per task type (vuln-remediation, dep-upgrade, etc.). They receive instructions from the conductor, generate code changes, and create PRs. These are the entry point to the pipeline.

### Failure Analyst (`agents/failure-analyst/`)

Monitors CI check_run events. Classifies failures as code bugs vs infra flakes. Routes code bugs back to fixers, retries infra flakes. Logs failure signatures for the distiller.

Key concepts: `FailureSignature`, `ClassificationPolicy`, `RetryPolicy`.

### Review Agent (`agents/review-agent/`)

Checklist-driven code review using Agentic RAG. Receives task-specific checklists from the conductor. Uses corporate memory (RAG database) to make context-aware review decisions. Approves, requests changes, or escalates to human.

Key concepts: `ReviewChecklist`, `CorporateMemory` port, `ReviewPolicy`.

### Distiller (`agents/distiller/`)

Post-merge summarization. Collects full pipeline context (failure → fix → review → merge), extracts lessons learned, and writes them to the RAG database for future agents to reference.

Key concepts: `Lesson`, `RagPort`, `SummarizationPolicy`.

## Orchestration (Conductor)

The `apps/conductor/` app coordinates the pipeline. It receives events (GitHub webhooks, agent completion signals), determines which agent acts next, and routes work. The conductor manages the pipeline state machine and handles retries, timeouts, and error escalation.

The leading orchestration engine candidate is **Inngest** (self-hosted, event-driven durable execution). See [`apps/conductor/README.md`](apps/conductor/README.md) for the full Inngest research, pricing analysis, Bun compatibility findings, and the `OrchestratorPort` design.

## Shared Package

`packages/shared/` contains common domain entities, application ports, and utility types that multiple agents need. This prevents duplication of core interfaces like `GitHubPort`, `LlmPort`, and entities like `PullRequest`, `CheckRun`.

The shared package will be populated gradually by extracting stable interfaces from `reviewer-agent` (the prototype). See [`packages/shared/README.md`](packages/shared/README.md) for the migration strategy.

## Architecture Principles

Every agent and app follows **Clean Architecture** (see [`clean-arch.md`](clean-arch.md)):

- **Domain layer** — entities, policies, value objects. No external dependencies.
- **Application layer** — use cases, port interfaces. Depends only on domain.
- **Adapter layer** — LLM adapters, GitHub adapters, storage adapters. Implements ports.
- **Dependencies always point inward.** LLMs, SDKs, and event buses are outer-layer concerns.

Agents are modeled as **policy-driven decision engines with unreliable advisors (LLMs)**. Clean architecture gives explicit homes for decisions, policies, state, and advisors.

## Legacy Note

`agents/reviewer-agent/` is the original prototype. It predates the monorepo structure and shared package. It has no `@tilsley/` scope, its own `node_modules`, and 107 passing tests. It remains self-contained and fully functional. Future work will migrate it to consume `@tilsley/shared` and integrate with the conductor — but not until the new architecture is proven.
