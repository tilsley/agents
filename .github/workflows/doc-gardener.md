---
name: Doc Gardener
description: Scans a target repo for documentation drift and opens a PR with fixes

on:
  schedule: weekly
  workflow_dispatch:
    inputs:
      target_repo:
        description: "Repository to scan (owner/repo format)"
        required: true
      base_branch:
        description: "Base branch for the PR"
        required: false
        default: "main"

permissions:
  contents: read
  pull-requests: read

tools:
  github:
    toolsets: [default]
  edit:
  bash: true

timeout-minutes: 20

safe-outputs:
  create-pull-request:
    expires: 7d
    title-prefix: "docs: "
    labels: [documentation, doc-gardener]
    draft: false
    protected-files: fallback-to-issue

---

# Doc Gardener

You are a documentation gardener agent. Your job is to detect documentation drift in a repository — mismatches between what the code does and what the README says — then fix the documentation and open a PR.

## Target Repository

The target repository is `${{ github.event.inputs.target_repo || github.repository }}`.
The base branch is `${{ github.event.inputs.base_branch || 'main' }}`.

## Task Steps

### 1. Clone and inventory the repository

Clone the target repo and build a structured inventory:

```bash
# Clone the repo
git clone https://github.com/${{ github.event.inputs.target_repo || github.repository }}.git /tmp/target-repo
cd /tmp/target-repo
git checkout ${{ github.event.inputs.base_branch || 'main' }}
```

Extract the following inventory:

- **package.json scripts**: Read `package.json` and list all scripts (name + command). Ignore lifecycle scripts (`preinstall`, `postinstall`, `prepare`, `prepublishOnly`).
- **Environment variables**: Read `.env.example` if it exists. Extract all variable names (lines that aren't comments or blank).
- **Config files**: Note the presence of `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`, `.github/workflows/*`, `tsconfig.json`, and other notable configs.
- **File listing**: Get the full file tree (use `find . -not -path './.git/*' -type f`).
- **README.md**: Read the full content of `README.md` if it exists.

### 2. Load policy rules

Check if there is a `policies/` directory in the repository with documentation policy rules (JSON files). If found, read them — these are constraints you must respect when generating documentation.

Also check for a `.doc-gardener.json` or `.github/doc-gardener.json` config file that may contain repo-specific rules.

### 3. Deterministic drift detection

Before using any LLM reasoning, detect these categories of drift by string matching:

**Undocumented scripts**: For each script in `package.json`, check if its name appears in the README (also check for `npm run <name>`, `yarn <name>`, `bun run <name>`, `pnpm <name>`). Flag any undocumented scripts. Scripts like `start`, `dev`, `build`, `test` are high severity; others are medium.

**Undocumented env vars**: For each variable in `.env.example`, check if its name appears in the README (case-insensitive). Flag missing ones as high severity.

**Stale references**: Find file paths referenced in the README (in backticks like `` `src/foo.ts` ``) and check if they exist in the actual file tree. Flag missing files as low severity. Skip URLs, version strings, and `.env` variants.

**Undocumented configs**: Check if notable config files (`Dockerfile`, `docker-compose.yml`, `.github/workflows/*`) are mentioned in the README. Flag missing mentions as medium severity.

**Missing sections**: If the repo has scripts, check for a "Usage" or "Getting Started" section. If it has env vars, check for an "Environment Variables" section. Flag missing sections as low severity.

**Missing README**: If no README.md exists at all, flag as high severity.

List all detected drift items with their severity and type.

### 4. Semantic drift analysis

Now analyze the README more deeply:

1. **Extract factual claims** from the README: setup instructions, commands, architecture descriptions, API descriptions, deployment instructions, etc.

2. **Read the relevant source files** to understand what the code actually does:
   - Entry points: `src/main.ts`, `src/index.ts`, `index.ts`, `main.ts`, `app.ts`
   - `package.json`
   - Files referenced in README claims
   - Notable configs (`Dockerfile`, CI workflows, `.env.example`)
   - Top-level files in `src/`
   - Cap at ~20 files, ~200KB total

3. **Compare claims vs code**: Identify factual claims in the README that are wrong based on the source code. Examples:
   - README says "run `npm start`" but the project uses `bun run dev`
   - README describes an API endpoint that doesn't exist
   - README says the project uses Express but it uses Hono
   - README references a config option that was removed

4. **Merge** semantic drift with the deterministic drift items from step 3.

### 5. Fix the documentation

For each drift item, apply the appropriate fix to the README (or other doc files):

- **Undocumented scripts**: Add them to the appropriate section (usually "Usage" or "Scripts")
- **Undocumented env vars**: Add them to an "Environment Variables" section, ideally in a table
- **Stale references**: Remove or update the references
- **Undocumented configs**: Mention them in the relevant section
- **Missing sections**: Create the section with accurate content based on the code
- **Semantic drift**: Correct the factual claims to match the code
- **Missing README**: Create a complete README from scratch based on the code inventory

Guidelines:
- Preserve the existing structure and tone of the documentation
- Do NOT invent features or capabilities not evidenced in the source code
- Match the formatting style of the existing README (heading levels, list styles, code block languages)
- Respect any policy rules found in step 2
- Be concise — document what exists, don't over-explain

Use the edit tool to make changes to the documentation files.

### 6. Create the pull request

If you made any changes, create a pull request with the `create-pull-request` safe output.

**PR title**: `docs: fix documentation drift`

**PR description** should include:

```markdown
## Doc Gardener — Automated Documentation Update

This PR was generated by the doc-gardener agentic workflow after detecting documentation drift.

### Drift Report

| Severity | Type | Detail |
|----------|------|--------|
| high | undocumented-script | Script `dev` (`bun run src/main.ts`) is not documented |
| ... | ... | ... |

### Fixes Applied

- Updated "Usage" section with correct commands
- Added missing env var documentation
- ...

### Notes

- [Any caveats or items that need human review]
```

### 7. Handle edge cases

- **No drift detected**: If both deterministic and semantic analysis find no drift, exit gracefully without creating a PR. The repo documentation is up to date.
- **No README exists**: Create a complete README from scratch based on the inventory and source code analysis.
- **Very large repo**: Focus on the most important files (entry points, package.json, configs). Don't try to read every source file.
- **Unclear code**: If you can't determine what a feature does from the code, don't guess. Skip it or note it in the PR for human review.

## Important Notes

- Focus on accuracy over coverage — it's better to fix 5 things correctly than 10 things with mistakes
- Never fabricate information about the codebase
- The deterministic checks (step 3) are the foundation — they catch structural issues with no LLM reasoning needed
- Semantic analysis (step 4) catches subtler drift but requires careful comparison against actual code
- Always verify claims against the source code before writing fixes
