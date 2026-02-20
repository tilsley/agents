# @tilsley/shared

Shared domain entities, application ports, and utility types for the multi-agent CI/CD platform.

## Purpose

This package is the common dependency for all agents and apps in the monorepo. It prevents duplication of core interfaces and entities that multiple packages need.

## What Will Live Here

Extractions from `agents/reviewer-agent/` (the prototype) and new shared abstractions:

**Domain entities** — `PullRequest`, `CheckRun`, `ReviewResult`, `FailureSignature`, `Lesson`

**Application ports** — `GitHubPort`, `LlmPort`, `RagPort` (interfaces that adapters implement)

**Utility types** — `Result<T, E>`, branded ID types, common value objects

## Migration Strategy

1. Identify stable interfaces in `reviewer-agent` that other agents will need.
2. Copy (not move) them here with any necessary generalization.
3. New agents depend on `@tilsley/shared` from day one.
4. Once the new agents are proven, update `reviewer-agent` to consume shared types.
5. Remove duplicated definitions from `reviewer-agent`.

This is intentionally gradual — `reviewer-agent` has 107 passing tests and stays untouched until migration is safe.

## Directory Structure

```
src/
├── index.ts                 # barrel export
├── domain/
│   ├── entities/            # shared domain entities
│   ├── policies/            # shared policy interfaces
│   └── utils/               # domain-level utilities
├── application/
│   └── ports/               # shared port interfaces
└── types/                   # utility types, branded IDs
```
