/**
 * One-time setup: GitHub App device flow → stores Copilot tokens in AWS SSM.
 *
 * Usage:
 *   bun scripts/copilot-auth.ts
 *
 * Env vars:
 *   GITHUB_APP_CLIENT_ID  — GitHub App's client ID (required)
 *   SSM_PREFIX            — SSM parameter prefix (default: /tilsley/agents/copilot)
 *   AWS_REGION            — AWS region (default: eu-west-2)
 *
 * Prerequisites:
 *   - GitHub App must have "Device flow" enabled in settings
 *   - The authorizing user must have a GitHub Copilot license
 *   - AWS credentials configured (env, profile, or IAM role)
 */

import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";

const clientId = process.env.GITHUB_APP_CLIENT_ID;
if (!clientId) {
  console.error("Error: GITHUB_APP_CLIENT_ID is required");
  process.exit(1);
}

const ssmPrefix = process.env.SSM_PREFIX ?? "/tilsley/agents/copilot";
const region = process.env.AWS_REGION ?? "eu-west-2";

// --- Step 1: Request device code ---

const deviceResponse = await fetch("https://github.com/login/device/code", {
  method: "POST",
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ client_id: clientId }),
});

if (!deviceResponse.ok) {
  console.error(`Failed to request device code: ${deviceResponse.status} ${await deviceResponse.text()}`);
  process.exit(1);
}

const device = (await deviceResponse.json()) as {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

// --- Step 2: Prompt user ---

console.log();
console.log(`  Open: ${device.verification_uri}`);
console.log(`  Code: ${device.user_code}`);
console.log();
console.log("Waiting for authorization...");

// Try to open the browser
try {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  Bun.spawn([cmd, device.verification_uri]);
} catch {
  // silently ignore — user can open manually
}

// --- Step 3: Poll for token ---

let interval = device.interval;
const deadline = Date.now() + device.expires_in * 1000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
}

let tokens: TokenResponse | null = null;

while (Date.now() < deadline) {
  await Bun.sleep(interval * 1000);

  const pollResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  const result = (await pollResponse.json()) as TokenResponse;

  if (result.access_token) {
    tokens = result;
    break;
  }

  if (result.error === "authorization_pending") {
    continue;
  }

  if (result.error === "slow_down") {
    interval += 5;
    continue;
  }

  if (result.error === "expired_token") {
    console.error("Device code expired. Please run the script again.");
    process.exit(1);
  }

  if (result.error === "access_denied") {
    console.error("Authorization denied by user.");
    process.exit(1);
  }

  console.error(`Unexpected error: ${result.error}`);
  process.exit(1);
}

if (!tokens?.access_token) {
  console.error("Timed out waiting for authorization.");
  process.exit(1);
}

console.log("Authorized.");

// --- Step 4: Store in SSM ---

const ssm = new SSMClient({ region });
const now = Math.floor(Date.now() / 1000);

const params = [
  { name: `${ssmPrefix}/access-token`, value: tokens.access_token! },
  { name: `${ssmPrefix}/refresh-token`, value: tokens.refresh_token! },
  { name: `${ssmPrefix}/access-token-expires-at`, value: String(now + (tokens.expires_in ?? 28800)) },
  { name: `${ssmPrefix}/refresh-token-expires-at`, value: String(now + (tokens.refresh_token_expires_in ?? 15897600)) },
  { name: `${ssmPrefix}/client-id`, value: clientId },
];

for (const p of params) {
  await ssm.send(
    new PutParameterCommand({
      Name: p.name,
      Value: p.value,
      Type: p.name.includes("token") && !p.name.includes("expires") ? "SecureString" : "String",
      Overwrite: true,
    })
  );
  console.log(`  Stored ${p.name}`);
}

console.log();
console.log(`Copilot tokens stored in SSM under ${ssmPrefix}/`);
console.log(`Access token expires in ${tokens.expires_in ?? 28800} seconds`);
console.log(`Refresh token expires in ${Math.floor((tokens.refresh_token_expires_in ?? 15897600) / 86400)} days`);
