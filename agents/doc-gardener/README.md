# Doc-Gardener Agent

Standalone agent that scans a target repo for documentation drift — mismatches between what the code does and what the README says — then opens a PR with fixes.

Supports three strategies:
- **Agentic** (default): multi-step loop with 4 LLM roles and self-review iterations (~7-18 LLM calls)
- **Single-pass**: one LLM call that receives all context and produces fixed files directly (1 premium request)
- **Agent**: one SDK session where the LLM explores the repo itself via built-in tools (`view`, `glob`, `edit`) and edits docs directly on disk (1 premium request)

## How it works

### Agentic mode (default)

```
Clone → Inventory + Deterministic Pre-filter
     → Doc Analyzer: extract claims from README
     → Code Analyzer: read source files, produce CodeSnapshot
     → Planner: compare claims vs code → DocUpdatePlan with FixItem[]
     ┌─ LOOP (max 3 iterations):
     │  → Writer: apply each fix (one at a time, priority order)
     │  → Doc Analyzer: re-extract claims from updated doc
     │  → Planner: re-run gap analysis
     │  → if no gaps or giveUp → exit loop
     └─
     → Commit, push, open PR
```

### Single-pass mode

```
Clone → Inventory + Deterministic Pre-filter
     → Load source files (same heuristic)
     → SinglePassFixer: 1 LLM call with all context → fixed files
     → Commit, push, open PR
```

One prompt containing the full inventory, source files, deterministic drift, policy rules, and existing docs. The LLM does claim extraction, code analysis, gap detection, and writing internally. Cost: 1 premium request.

### Agent mode

```
Clone → Inventory + Deterministic Pre-filter
     → Load .md files + full file listing
     → Agent session: LLM explores repo via view/glob, edits via edit
     → Detect changes via git diff + git ls-files
     → Commit, push, open PR
```

The LLM receives pre-loaded context (all `.md` files, inventory, policy rules, full file listing, repo template) plus SDK built-in tools (`view`, `glob`, `edit`, `create`) to explore source code and edit docs directly on disk. Bypasses the file-selection heuristic entirely — the LLM reads whatever files it needs. Cost: 1 premium request (one SDK session regardless of tool calls).

### Repo templates

Agent mode supports **repo templates** — structured definitions of what files, sections, and constraints a repo's documentation must satisfy. Templates are loaded from `policies/global/repo-template.json` (with repo-specific overrides in `policies/repos/{owner}/{repo}/repo-template.json`).

The default template requires:
- **README.md** with Quick Start, Configuration, Architecture sections
- **ARCHITECTURE.md** with Overview, Components, Data Flow sections and a Mermaid diagram
- **SECURITY.md**
- **CODEOWNERS**
- **docs/adr/** directory (validated if present, not auto-created)

The agent treats the template as a structural checklist — it creates missing files, adds missing sections, and satisfies constraints (like generating a Mermaid architecture diagram). See `policies/global/repo-template.json` for the full schema.

### 1. Inventory extraction (deterministic)

Reads the repo and builds a structured inventory:

- `package.json` scripts (e.g. `start`, `test`, `build`)
- `.env.example` environment variables
- Config files (`Dockerfile`, `tsconfig.json`, `.github/workflows/*`, etc.)
- Full file listing (for stale reference detection)
- Existing `README.md` parsed into sections by heading

### 2. Policy rules

Loads rules from the **policy store** (`policies/` directory) — type `documentation`, both global and repo-specific. Rules are constraints the LLM must respect when generating content.

Example rules:
- "Always document environment variables in a table format"
- "Don't document internal helpers"
- "README must have a 'Deployment' section"

### 3. Deterministic drift detection (step 0 pre-filter)

Five pure-function detectors in `src/domain/policies/drift-detection-policy.ts`. Tuned for precision over recall — they only flag things that are clearly wrong, leaving subtler judgement calls to the LLM.

| Detector | What it catches | Severity |
|---|---|---|
| `detectScriptDrift` | User-facing scripts (`start`, `dev`, `build`, `test`, `serve`, `preview`, `deploy`) not mentioned in README. Skips tooling scripts (`lint`, `format`, `clean`, etc.). Word-boundary matching avoids "test" matching "latest". | high |
| `detectEnvVarDrift` | `.env.example` vars not mentioned in README. Skips generic vars everyone knows (`NODE_ENV`, `PORT`, `HOST`, etc.). Searches raw content so vars in code blocks/tables count. | high |
| `detectStaleReferences` | Backtick-wrapped file paths in README prose that don't exist on disk. Requires a path separator or known source extension — won't false-positive on `React.Component` or `express.Router`. Ignores refs inside fenced code blocks. | low |
| `detectUndocumentedConfigs` | Docker files (`Dockerfile`, `docker-compose.yml`) exist but "docker" isn't mentioned anywhere in the README. Single flag, not per-file. CI workflow files are not flagged. | medium |
| `detectMissingDocs` | No README at all, or policy-required sections missing. Also checks for "Usage" section if scripts exist, "Environment" section if env vars exist. | high/medium |

### 4. Agentic loop (4 LLM roles)

| Role | Port | What it does |
|---|---|---|
| **Doc Analyzer** | `DocAnalyzerLlmPort` | Extracts factual claims from README |
| **Code Analyzer** | `CodeAnalyzerLlmPort` | Reads source files, produces structured `CodeSnapshot` |
| **Planner** | `DocPlannerLlmPort` | Compares claims vs code, produces prioritized fix list |
| **Writer** | `DocWriterLlmPort` | Applies a single fix at a time |

The self-review step reuses Doc Analyzer + Planner (re-extract claims from updated doc, re-run gap analysis). Loop exits when planner returns zero gaps, `maxIterations` reached, or planner sets `giveUp: true`.

Cost: ~7 LLM calls on happy path (4 initial + 2 review + 1 writer), ~13 worst case (3 iterations).

### 5. PR creation

Creates a branch, writes the generated files, commits, pushes, and opens a PR via `GitHubPort.createPullRequest()`. The PR body includes the drift report table (with deterministic vs semantic source), policy rules applied, fixes applied, and iteration count.

## Usage

There are three ways to run doc-gardener, depending on your environment and cost constraints.

### 1. Local / CI via Make (TypeScript agent)

Runs the full TypeScript agent with `CopilotSdkAdapter`. Choose a strategy:

```bash
# Agentic mode (default) — 4 LLM roles with self-review loop (~7-18 LLM calls)
make doc-gardener TARGET_REPO=my-repo

# Single-pass mode — 1 LLM call, all context in one prompt
STRATEGY=single-pass make doc-gardener TARGET_REPO=my-repo

# Agent mode — LLM explores repo via SDK built-in tools (1 premium request)
STRATEGY=agent make doc-gardener TARGET_REPO=my-repo

# With debug logging
LLM_DEBUG=1 make doc-gardener TARGET_REPO=my-repo

# Custom owner and base branch
make doc-gardener TARGET_REPO=my-repo TARGET_OWNER=my-org BASE_BRANCH=develop
```

**When to use which strategy:**

| | Agentic | Single-pass | Agent |
|---|---|---|---|
| LLM calls | ~7-18 | 1 | 1 |
| Premium requests | ~7-18 | 1 | 1 |
| File selection | Heuristic | Heuristic | LLM explores via tools |
| Quality | Higher (self-review catches mistakes) | Good (no review pass) | Best (reads actual source) |
| Best for | Token-based pricing (Bedrock/Anthropic) | Premium-request pricing (Copilot API) | Premium-request pricing + accuracy |

### 2. GitHub Agentic Workflows (`gh aw`)

A natural language version of the same logic, running entirely inside GitHub Actions via a coding agent. No TypeScript — the agent interprets Markdown instructions.

```bash
# One-time setup: compile the workflow
gh aw compile .github/workflows/doc-gardener.md

# Commit both the .md and the generated .lock.yml
git add .github/workflows/doc-gardener.md .github/workflows/doc-gardener.lock.yml
git commit -m "ci: add doc-gardener agentic workflow"
git push
```

Then trigger it:

```bash
# Manual trigger via CLI
gh workflow run doc-gardener --field target_repo=owner/my-repo --field base_branch=main

# Or trigger from the Actions tab on GitHub
```

It also runs on a weekly schedule by default (configurable in the frontmatter).

**Trade-offs vs the TypeScript agent:**
- No deterministic guarantees — the coding agent follows natural language instructions instead of running pure-function detectors
- No self-review loop — single pass only
- No policy store integration — policies must live in the target repo
- Simpler to deploy — no Bun runtime, no `@github/copilot-sdk` dependency
- Uses `create-pull-request` safe output — the agent never has direct write access

### 3. GitHub Actions (TypeScript agent in CI)

Run the TypeScript agent as a regular Actions job. Requires a Copilot-authenticated token or a direct LLM API key.

```yaml
# .github/workflows/doc-gardener-ci.yml
name: Doc Gardener
on:
  schedule:
    - cron: '0 8 * * 1'  # Weekly Monday 8am
  workflow_dispatch:
    inputs:
      target_repo:
        description: 'Repo to scan'
        required: true

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run agents/doc-gardener/src/main.ts
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_REPO: ${{ inputs.target_repo }}
          TARGET_OWNER: ${{ github.repository_owner }}
          STRATEGY: single-pass  # recommended for CI to minimize premium requests
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | yes | — | GitHub PAT with repo access |
| `TARGET_REPO` | yes | — | Repository name to scan |
| `TARGET_OWNER` | no | `tilsley` | Repository owner |
| `BASE_BRANCH` | no | `main` | Base branch for the PR |
| `COPILOT_GITHUB_TOKEN` | no | `GITHUB_TOKEN` | Token for Copilot SDK auth |
| `STRATEGY` | no | `agentic` | `agentic` (multi-role loop), `single-pass` (1 LLM call), or `agent` (SDK tool-use session) |
| `MAX_REVIEW_ITERATIONS` | no | `3` | Max self-review loop iterations (agentic only) |
| `REASONING_EFFORT` | no | — | `low`, `medium`, `high`, or `xhigh` — enables extended thinking |
| `LLM_DEBUG` | no | — | Set to `1` or `verbose` for LLM logging (includes thinking output) |

## Feedback capture

When a human comments on a doc-gardener PR, the **conductor** classifies the comment via LLM. If it contains a reusable rule (e.g. "don't document internal helpers"), it gets written to the policy store. The next doc-gardener run loads that rule and passes it as a constraint to the LLM.

This is the feedback loop: `agent PR → human comment → policy rule → better agent PR`.

## Architecture

```
src/
  main.ts                                    # wiring (SDK adapter + strategy branch)
  application/
    ports/
      repo-scanner.port.ts                   # clone, list, read, write, commit+push
      doc-analyzer-llm.port.ts               # extract claims from docs (agentic)
      code-analyzer-llm.port.ts              # analyze source → CodeSnapshot (agentic)
      doc-planner-llm.port.ts                # gap analysis → DocUpdatePlan (agentic)
      doc-writer-llm.port.ts                 # apply single fix (agentic)
      single-pass-fixer-llm.port.ts          # 1-call fix (single-pass)
      agent-fixer-llm.port.ts                # agent session fix (agent)
    use-cases/
      scan-repo-docs.ts                      # main use case — strategy branch
  adapters/
    git/
      git-shell-scanner.adapter.ts           # RepoScannerPort via shell commands
    llm/
      copilot-doc-analyzer.adapter.ts        # DocAnalyzerLlmPort via CopilotSdk
      copilot-code-analyzer.adapter.ts       # CodeAnalyzerLlmPort via CopilotSdk
      copilot-doc-planner.adapter.ts         # DocPlannerLlmPort via CopilotSdk
      copilot-doc-writer.adapter.ts          # DocWriterLlmPort via CopilotSdk
      copilot-single-pass-fixer.adapter.ts   # SinglePassFixerLlmPort via CopilotSdk
      copilot-agent-fixer.adapter.ts         # AgentFixerLlmPort via CopilotSdk agent session
  domain/
    entities/
      drift-report.ts                        # DriftItem (now with source, claim, etc.)
      doc-update-plan.ts                     # DocUpdatePlan with FixItem[]
      doc-claim.ts                           # DocClaim (extracted from docs)
      code-snapshot.ts                       # CodeSnapshot (from code analysis)
      gardener-result.ts                     # GardenerResult (final output)
    policies/
      drift-detection-policy.ts              # pure functions — deterministic detectors
      file-selection-policy.ts               # heuristic for selecting source files
    utils/
      parse-readme.ts                        # split README into sections by heading
      format-pr-body.ts                      # format plan as PR description
```

Uses `CopilotSdkAdapter` (`@github/copilot-sdk`) — each `completeJson()` call goes through the native Copilot CLI binary via JSON-RPC. The LLM adapters are swappable — replace with a Bedrock/Anthropic adapter for direct API access.
