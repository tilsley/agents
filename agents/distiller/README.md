# @tilsley/distiller

Post-merge summarization and corporate memory writer.

## Role

The Distiller Agent performs post-merge summarization and feeds the corporate memory / RAG database.

**Responsibilities:**

1. Triggered by the conductor after a PR is merged.
2. Collect all context from the pipeline: the original fixer task, failure analyst logs, review agent feedback, the final PR diff.
3. Use an LLM to summarize: what was the problem, what was tried, what worked, what failed, what was learned.
4. Store the structured summary as a "lesson learned" in the RAG database.
5. Tag the lesson with metadata: agent type, repo, failure type, date, outcome.

## Key Domain Concepts

- **`Lesson`** entity — structured representation of a lesson learned (problem, solution, context, tags).
- **`RagPort`** — interface to the vector database / RAG storage.
- **`SummarizationPolicy`** — rules for what to include, how detailed, deduplication.

## Directory Structure

```
src/
├── main.ts
├── domain/
│   ├── entities/        # Lesson, PipelineContext
│   ├── policies/        # SummarizationPolicy
│   └── utils/
├── application/
│   ├── ports/           # RagPort, LlmPort
│   └── use-cases/       # DistillLessons, PersistToRag
└── adapters/            # RAG adapter, LLM adapter
```
