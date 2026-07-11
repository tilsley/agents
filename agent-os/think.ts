#!/usr/bin/env bun
/**
 * think — the gateway's first external client (ADR-0039), and the smoke test for
 * governed inference: sign in, send one prompt to POST /v1/generate on the
 * inference gateway, print the answer. This is exactly the call a delegated
 * (sandboxed/custom) agent makes from inside its box — verified identity in,
 * metered tokens out, no model credentials anywhere on this machine.
 *
 *   GATEWAY_URL=https://…lambda-url…on.aws bun agent-os/think.ts "why is the sky blue?"
 */
import { login, platformConfig } from "./login";

const gateway = process.env.GATEWAY_URL?.replace(/\/$/, "");
if (!gateway) throw new Error("set GATEWAY_URL (the AgentOsGateway stack output)");
const prompt = process.argv.slice(2).join(" ").trim() || "Say hello and name the model you are.";

const cfg = await platformConfig();
const token = await login(cfg);

const res = await fetch(`${gateway}/v1/generate`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  // maxTokens is mandatory on the platform wire: the gateway reserves worst-case
  // budget against it before invoking the model, so there is no default to fall back on.
  body: JSON.stringify({ messages: [{ role: "user", text: prompt }], maxTokens: 512 }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`FAILED (${res.status}): ${JSON.stringify(body)}`);
  process.exit(1);
}
console.log((body as any).text ?? JSON.stringify(body, null, 2));
if ((body as any).usage) console.error(`\n[metered: ${JSON.stringify((body as any).usage)}]`);
