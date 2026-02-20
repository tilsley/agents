# @tilsley/review-agent

Checklist-driven code review with RAG-powered corporate memory.

## Role

The Review Agent provides a "fresh set of eyes" checklist-driven code review of pull requests created by fixer agents.

**Responsibilities:**

1. Receive a review task from the conductor (triggered when all CI checks pass on a bot-authored PR).
2. Receive a task-specific checklist from the conductor (e.g., "for vuln-remediation PRs, verify: CVE addressed, no new vulns introduced, backwards compatible").
3. Fetch the PR diff and context from GitHub.
4. Use Agentic RAG to retrieve relevant corporate memory — past lessons learned, past review decisions on similar changes.
5. Evaluate the PR against the checklist, scoring each item.
6. Decide: approve, request changes, or escalate to human.
7. Post review comment with structured feedback.

## Key Domain Concepts

- **`ReviewChecklist`** entity — a list of criteria with weights.
- **`CorporateMemory`** port — interface to the RAG database.
- **`ReviewPolicy`** — thresholds for approve/reject/escalate, customizable per checklist.

## Relationship to reviewer-agent

The current `agents/reviewer-agent/` has eval logic in `HandlePrEval`. The new review-agent is a more sophisticated version designed to work within the pipeline, with RAG integration and checklist-driven evaluation. The reviewer-agent will continue to operate independently until the new review-agent is feature-complete.

## Directory Structure

```
src/
├── main.ts
├── domain/
│   ├── entities/        # ReviewChecklist, ReviewResult
│   ├── policies/        # ReviewPolicy
│   └── utils/
├── application/
│   ├── ports/           # CorporateMemory, LlmPort, GitHubPort
│   └── use-cases/       # EvaluatePR, ScoreChecklist
└── adapters/            # RAG adapter, LLM adapter, GitHub adapter
```
