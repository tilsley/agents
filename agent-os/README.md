# agent-os agents

Agent definitions for the [agent-os](https://github.com/tilsley/agent-os) platform —
**definitions as data** (ADR-0038). An agent here is a JSON `AgentSpec` in
`definitions/`; registering it is a gated platform API call, not an AWS write:

```bash
bun agent-os/register.ts            # sign in (browser), apply all definitions
bun agent-os/register.ts scribe     # apply one
bun agent-os/register.ts --delete scribe
```

The script discovers the platform endpoints from the deployed console's public
`config.json`, signs you in via the Cognito hosted UI (code + PKCE, localhost
callback), and `POST /agents` does the rest — the platform validates the spec,
authorizes the write, and stamps YOUR tenant as the owner. This repo holds no
endpoints beyond the console URL, no credentials, and no AWS access.

Registered agents appear in the console's agent picker immediately — runs against
them are gated, metered, and traced like everything else.

## Spec shape

```jsonc
{
  "name": "scribe",              // lowercase slug (the console picker name)
  "kind": "loop",                // loop | sandboxed | claude-code
  "model": "amazon.nova-lite-v1:0",
  "systemPrompt": "…",           // max 8000 chars
  "maxSteps": 6                  // 1-50
}
```

`tenant` is not part of the file — ownership comes from whoever registers it.
