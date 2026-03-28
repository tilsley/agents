import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";

/**
 * Manages Copilot OAuth tokens stored in SSM.
 * Reads the access token, refreshes via GitHub if expired,
 * and writes the new tokens back to SSM.
 */
export class CopilotTokenAdapter {
  private ssm: SSMClient;

  constructor(
    private prefix: string = "/tilsley/agents/copilot",
    region?: string
  ) {
    this.ssm = new SSMClient({ region: region ?? process.env.AWS_REGION ?? "eu-west-2" });
  }

  /**
   * Returns a valid Copilot access token.
   * Refreshes automatically if the current token is expired or near expiry.
   */
  async getToken(): Promise<string> {
    const [accessToken, expiresAtStr] = await Promise.all([
      this.getParam(`${this.prefix}/access-token`, true),
      this.getParam(`${this.prefix}/access-token-expires-at`),
    ]);

    const expiresAt = parseInt(expiresAtStr, 10);
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 300; // refresh 5 minutes early

    if (now + bufferSeconds < expiresAt) {
      return accessToken;
    }

    console.log("[copilot-token] Access token expired or near expiry, refreshing...");
    return this.refresh();
  }

  private async refresh(): Promise<string> {
    const [refreshToken, clientId] = await Promise.all([
      this.getParam(`${this.prefix}/refresh-token`, true),
      this.getParam(`${this.prefix}/client-id`),
    ]);

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `[copilot-token] Token refresh failed: ${response.status} ${await response.text()}`
      );
    }

    const result = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (result.error) {
      throw new Error(
        `[copilot-token] Token refresh error: ${result.error} — ${result.error_description}`
      );
    }

    if (!result.access_token || !result.refresh_token) {
      throw new Error("[copilot-token] Token refresh returned no tokens");
    }

    // Store new tokens in SSM
    const now = Math.floor(Date.now() / 1000);
    await Promise.all([
      this.putParam(`${this.prefix}/access-token`, result.access_token, "SecureString"),
      this.putParam(`${this.prefix}/refresh-token`, result.refresh_token, "SecureString"),
      this.putParam(`${this.prefix}/access-token-expires-at`, String(now + (result.expires_in ?? 28800))),
      this.putParam(`${this.prefix}/refresh-token-expires-at`, String(now + (result.refresh_token_expires_in ?? 15897600))),
    ]);

    console.log("[copilot-token] Tokens refreshed and stored in SSM");
    return result.access_token;
  }

  private async getParam(name: string, decrypt = false): Promise<string> {
    const result = await this.ssm.send(
      new GetParameterCommand({ Name: name, WithDecryption: decrypt })
    );
    const value = result.Parameter?.Value;
    if (!value) {
      throw new Error(`[copilot-token] SSM parameter not found: ${name}`);
    }
    return value;
  }

  private async putParam(
    name: string,
    value: string,
    type: "String" | "SecureString" = "String"
  ): Promise<void> {
    await this.ssm.send(
      new PutParameterCommand({ Name: name, Value: value, Type: type, Overwrite: true })
    );
  }
}
