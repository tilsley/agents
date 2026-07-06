#!/usr/bin/env bun
/**
 * Register agent definitions with the agent-os platform (ADR-0038) — GitOps as a
 * CLIENT of the platform API, not a tunnel around it. No AWS credentials: you log
 * in as yourself (Cognito hosted UI, code+PKCE against the SAME app client the
 * console uses — http://localhost:5173/ is a registered callback), and every spec
 * is validated, authorized, and tenant-stamped by the platform's gate.
 *
 *   bun agent-os/register.ts                 # apply every definitions/*.json
 *   bun agent-os/register.ts scribe          # apply one definition
 *   bun agent-os/register.ts --delete scribe # remove one
 *
 * Config is discovered from the deployed console's public config.json — this
 * repo holds agent DEFINITIONS only, no endpoints and no secrets.
 */
const CONSOLE_URL = "https://d1x3uwxrkjekua.cloudfront.net";
const PORT = 5173;

const cfg = (await (await fetch(`${CONSOLE_URL}/config.json`)).json()) as {
  apiUrl: string;
  hostedUiBaseUrl: string;
  clientId: string;
};
const api = cfg.apiUrl.replace(/\/$/, "");

// ---- login: code + PKCE, catching the redirect on the registered localhost callback ----
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

const code = await new Promise<string>((resolve, reject) => {
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      const got = url.searchParams.get("code");
      if (!got) return new Response("waiting for login…");
      if (url.searchParams.get("state") !== state) {
        reject(new Error("state mismatch"));
        return new Response("state mismatch", { status: 400 });
      }
      resolve(got);
      setTimeout(() => server.stop(), 100);
      return new Response("Signed in - you can close this tab and return to the terminal.");
    },
  });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: `http://localhost:${PORT}/`,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  const authorize = `${cfg.hostedUiBaseUrl}/oauth2/authorize?${params}`;
  console.log("opening browser to sign in…");
  Bun.spawn(["open", authorize]); // macOS; print the URL as fallback
  console.log(`(if nothing opened: ${authorize})`);
});

const tokenRes = await fetch(`${cfg.hostedUiBaseUrl}/oauth2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.clientId,
    code,
    redirect_uri: `http://localhost:${PORT}/`,
    code_verifier: verifier,
  }),
});
if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
const { id_token } = (await tokenRes.json()) as { id_token: string };
const auth = { authorization: `Bearer ${id_token}` };

// ---- apply / delete ----
const args = process.argv.slice(2);
if (args[0] === "--delete") {
  const name = args[1];
  if (!name) throw new Error("usage: register.ts --delete <name>");
  const res = await fetch(`${api}/agents/${name}`, { method: "DELETE", headers: auth });
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
  const res = await fetch(`${api}/agents`, {
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
