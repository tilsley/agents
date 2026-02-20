# @tilsley/conductor

The orchestration layer that coordinates the multi-agent CI/CD pipeline.

## What the Conductor Does

The conductor receives events (GitHub webhooks, agent completion signals, timer triggers), determines which agent should act next, and routes work accordingly. It manages the pipeline state machine:

```
Fixer → CI → Failure Analyst → Review Agent → Merge → Distiller → RAG → (feedback loop)
```

## Inngest Research

Inngest is the leading candidate for the orchestration engine behind the conductor. This section captures all research findings.

### How Inngest Works

**The three primitives:**

- **Events** — JSON payloads with a name and data. Example: `{ name: "ci/failure.detected", data: { owner: "tilsley", repo: "agents", prNumber: 42 } }`. Anything can send events: webhooks, other functions, cron triggers, or direct API calls.

- **Functions** — Application code that responds to events. Each function declares which event(s) trigger it. A function can be a simple handler or a multi-step workflow.

- **Steps** — The durability primitive. Each `step.run("name", async () => { ... })` call inside a function is independently retryable, memoized, and persisted. If step 3 fails, steps 1 and 2 are not re-executed on retry — their results are injected from the state store.

**The execution model is replay-based memoization:**

Each step is a separate HTTP request to your server. The function handler re-executes from the top every time, but the SDK short-circuits completed steps by injecting their cached results. This is how durability works — not long-running processes, but deterministic replay.

This means:
- Function code must be deterministic between steps (no random values outside of `step.run` boundaries).
- Any code outside of `step.run()` blocks executes on every replay. Side effects outside steps will repeat.
- Step IDs must be stable across code versions — renaming a step ID breaks in-flight runs.

### Pricing

| | Hobby (Free) | Pro | Enterprise |
|---|---|---|---|
| Price | $0/mo | Starting at $75/mo | Custom |
| Executions | 50,000/mo | 1,000,000/mo | Custom |
| Events | 100,000/mo | 5M/mo | Custom |
| Concurrent steps | 5 | 100+ | 500-50,000 |
| Workers | 3 | 20 | Custom |
| Sleep duration | 7 days max | Up to 1 year | Up to 1 year |
| Payload size | 256KB | 3MB | Custom |

**Self-hosting eliminates pricing entirely** — no execution limits, no concurrency caps. This is the most relevant option for our situation.

### Bun Compatibility

Inngest has first-class Bun support:

- The SDK provides an `inngest/bun` handler that integrates directly with `Bun.serve()`.
- The testing package (`@inngest/test`) supports `bun:test`.
- For Connect mode (persistent WebSocket), Bun 1.1+ is required.
- The Inngest CLI itself is a Go binary (separate from your app code).
- Your existing Hono + `Bun.serve()` setup integrates cleanly — the Inngest serve handler can be mounted as a Hono route.

### Pipeline Mapping

How our multi-agent pipeline maps to Inngest's event/function model:

| Event | Inngest Function | Agent |
|---|---|---|
| `ci/check-run.completed` | `analyze-failure` | Failure Analyst |
| `agent/failure-analyst.completed` | `dispatch-to-fixer` or `retry-check` | Conductor routing |
| `ci/all-checks.passed` | `review-pr` | Review Agent |
| `agent/review.completed` | `merge-or-request-changes` | Conductor routing |
| `pr/merged` | `distill-lessons` | Distiller |

Key Inngest features for this pipeline:
- `step.waitForEvent()` — Review Agent can pause waiting for CI results on a fix PR without holding a process open.
- `step.invoke()` — Failure Analyst can directly invoke Fixer and wait for its result (RPC-style).
- Automatic per-step retries — if the LLM API is rate-limited during one step, only that step retries.
- Fan-out — multiple functions can trigger on the same event (e.g., Failure Analyst + Metrics Logger both react to `ci/failure.detected`).

### The OrchestratorPort Pattern

In clean architecture, Inngest lives at the adapter layer — the same level as `GitHubAdapter` and `CopilotAdapter`. The conductor defines an `OrchestratorPort` interface in its application layer:

```ts
interface OrchestratorPort {
  emit(event: PipelineEvent): Promise<void>;
  // subscribe, schedule, etc.
}
```

- **Production**: `InngestAdapter` implements the port.
- **Tests**: `InMemoryOrchestratorAdapter` implements the port.
- **Alternative**: `BullMQAdapter`, DIY Redis queue, etc.

Domain logic and use cases never import Inngest. If we later swap to Temporal, a DIY solution, or something else, we replace the adapter.

### Gotchas

**Step replay footguns:**
- Every step is a separate HTTP request. A function with 10 steps means 10+ invocations of the handler. Side effects outside `step.run()` blocks fire on every replay.
- Inngest moved from implicit to explicit step IDs after hitting production bugs where step renames broke in-flight runs.

**Step ID stability:**
- Renaming a step ID breaks in-flight function runs. To update past functions, you need to find all past run IDs and hit an API endpoint to migrate.

**State size limits:**
- 1000 steps maximum per function.
- 32MB total function run state (all step return values combined).
- 4MB per individual step return value.
- For CI/CD workflows with large diffs or build logs, store payloads externally and pass references through steps.

**October 2025 production incident:**
- Week-long cascade (Oct 16-23): Kafka disk exhaustion → Event API crash-loop → AWS RDS IOPS throttling → hit during AWS us-east-1 outage on Oct 20 → observability data loss → mid-incident database migration to PlanetScale.
- Relevant because: (1) if using their cloud, their operational maturity is still developing; (2) if self-hosting, we inherit the same architectural complexity.

**Concurrency on free tier:**
- 5 concurrent steps across the entire account. Three agents processing different PRs simultaneously will exceed this. Self-hosting removes this limit.

### DIY Alternative Assessment

What we'd need to build without Inngest:

| Capability | DIY Effort | Inngest Built-in |
|---|---|---|
| Event routing | Low (extend existing EventBufferPort) | Yes |
| Retry per step | Medium | Yes |
| State memoization | Medium-High | Yes |
| Wait-for-event | Medium | Yes (`waitForEvent`) |
| Concurrency control | Low | Yes |
| Observability dashboard | High (skip, use logs) | Yes |
| Multi-step durability | High | Yes |

The DIY path works if the pipeline stays simple (2-3 agents, linear chains). The moment we need arbitrary DAGs, wait-for-external-event, or visibility into stalled chains, we'll wish we had Inngest.

**Middle path**: Use Inngest purely as the orchestration/durability layer behind the `OrchestratorPort`. Domain logic stays clean. Swap later if needed.

### AgentKit Verdict

**Skip it.** We have our own agent abstractions via clean architecture. AgentKit's centralized router pattern conflicts with our event-driven dispatch + domain policies model. It would add an opaque middle layer between our domain and LLM adapter. Community feedback confirms it gets verbose for multi-agent workflows.

Use Inngest's core primitives only: `step.run`, `step.invoke`, `step.waitForEvent`, `step.sendEvent`.

### Self-Hosting

Inngest is a single Go binary. Run `inngest start` and it launches all services in one process with embedded Redis and SQLite — zero external dependencies.

**Deployment options:**
- **Dev/low-volume**: Docker container, single process, SQLite.
- **Production**: Docker Compose with PostgreSQL + Redis.
- **Kubernetes**: Official Helm chart with KEDA autoscaling.

Licensed under SSPL (free for internal use, not for offering as a service).

## Clean Architecture Structure

```
src/
├── main.ts                          # entry point
├── domain/
│   ├── entities/                    # pipeline state, agent task descriptors
│   ├── policies/                    # routing rules, retry policies
│   └── utils/
├── application/
│   ├── ports/
│   │   └── orchestrator.port.ts     # event bus abstraction
│   └── use-cases/                   # route event → agent, handle completion
└── adapters/                        # Inngest adapter (or DIY)
```

## Next Steps

1. Define the full `OrchestratorPort` interface (subscribe, schedule, waitForEvent).
2. Implement `InMemoryOrchestratorAdapter` for testing.
3. Build the first pipeline: `check_run.completed` → failure-analyst → rerun/close.
4. Integrate Inngest SDK and implement `InngestAdapter`.
5. Swap to Inngest adapter for production.
