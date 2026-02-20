# @tilsley/agents

A multi-agent CI/CD platform — autonomous agents that monitor, fix, review, and learn from pipeline events.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full system design and pipeline diagram.
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
bun test             # run all tests across the monorepo
```

## Status

| Package | Status |
|---|---|
| `reviewer-agent` | Operational (107 tests) |
| `@tilsley/shared` | Scaffold |
| `@tilsley/conductor` | Scaffold |
| `@tilsley/failure-analyst` | Scaffold |
| `@tilsley/review-agent` | Scaffold |
| `@tilsley/distiller` | Scaffold |
