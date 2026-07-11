/**
 * Shared hosted-UI login for agent-os scripts (ADR-0038/0039): authorization code +
 * PKCE against the same Cognito app client the console uses, catching the redirect
 * on the registered http://localhost:5173/ callback. Returns the id token — the
 * Bearer credential every agent-os surface verifies.
 */
const CONSOLE_URL = "https://d1x3uwxrkjekua.cloudfront.net";
const PORT = 5173;

export interface PlatformConfig {
  apiUrl: string;
  hostedUiBaseUrl: string;
  clientId: string;
}

export async function platformConfig(): Promise<PlatformConfig> {
  const cfg = (await (await fetch(`${CONSOLE_URL}/config.json`)).json()) as PlatformConfig;
  cfg.apiUrl = cfg.apiUrl.replace(/\/$/, "");
  return cfg;
}

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export async function login(cfg: PlatformConfig): Promise<string> {
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
    console.error("opening browser to sign in…");
    Bun.spawn(["open", authorize]); // macOS; URL printed as fallback
    console.error(`(if nothing opened: ${authorize})`);
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
  return id_token;
}
