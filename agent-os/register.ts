#!/usr/bin/env bun
/**
 * Register agent definitions with the agent-os platform (ADR-0038) — GitOps as a
 * CLIENT of the platform API, not a tunnel around it. No AWS credentials: you log
 * in as yourself (login.ts — Cognito hosted UI, code+PKCE), and every spec is
 * validated, authorized, and tenant-stamped by the platform's gate.
 *
 *   bun agent-os/register.ts                 # apply every definitions/*.json
 *   bun agent-os/register.ts scribe          # apply one definition
 *   bun agent-os/register.ts --delete scribe # remove one
 */
import { browserLogin, platformConfig } from "@agent-os/client";
import { CONSOLE_URL } from "./platform";

const cfg = await platformConfig(CONSOLE_URL);
const token = await browserLogin(cfg);
const auth = { authorization: `Bearer ${token}` };

const args = process.argv.slice(2);
if (args[0] === "--delete") {
  const name = args[1];
  if (!name) throw new Error("usage: register.ts --delete <name>");
  const res = await fetch(`${cfg.apiUrl}/agents/${name}`, { method: "DELETE", headers: auth });
  console.log(`${res.ok ? "deleted" : `FAILED (${res.status})`}: ${name} ${res.ok ? "" : await res.text()}`);
  process.exit(res.ok ? 0 : 1);
}

const dir = new URL("./definitions/", import.meta.url).pathname;
const glob = new Bun.Glob("*.json");
let failed = 0;
for await (const file of glob.scan(dir)) {
  const name = file.replace(/\.json$/, "");
  if (args.length && !args.includes(name)) continue;
  const spec = await Bun.file(dir + file).json();
  const res = await fetch(`${cfg.apiUrl}/agents`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    console.log(`${res.status === 201 ? "registered" : "updated"}: ${spec.name} (tenant=${(body as any).tenant})`);
  } else {
    failed++;
    console.error(`FAILED ${spec.name} (${res.status}): ${JSON.stringify(body)}`);
  }
}
process.exit(failed ? 1 : 0);
