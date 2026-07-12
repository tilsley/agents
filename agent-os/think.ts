#!/usr/bin/env bun
/**
 * think — one governed generate through the inference gateway (ADR-0039/0040),
 * now via @agent-os/client. Two identities, one wire:
 *
 *   human (default):  GATEWAY_URL=https://… bun agent-os/think.ts "why is the sky blue?"
 *   machine (M2M):    GATEWAY_URL=https://… M2M_CLIENT_ID=… M2M_CLIENT_SECRET=… \
 *                       bun agent-os/think.ts "why is the sky blue?"
 *
 * The machine path is ADR-0041's proof: no browser, no human, no AWS creds —
 * a service credential in, metered tokens out.
 */
import { GatewayClient, browserLogin, machineTokenProvider, platformConfig } from "@agent-os/client";
import { CONSOLE_URL } from "./platform";

const gatewayUrl = process.env.GATEWAY_URL;
if (!gatewayUrl) throw new Error("set GATEWAY_URL (the AgentOsGateway stack output)");
const prompt = process.argv.slice(2).join(" ").trim() || "Say hello and name the model you are.";

const cfg = await platformConfig(CONSOLE_URL);
const { M2M_CLIENT_ID, M2M_CLIENT_SECRET } = process.env;
const token =
  M2M_CLIENT_ID && M2M_CLIENT_SECRET
    ? machineTokenProvider({ hostedUiBaseUrl: cfg.hostedUiBaseUrl, clientId: M2M_CLIENT_ID, clientSecret: M2M_CLIENT_SECRET })
    : await browserLogin(cfg);

const gateway = new GatewayClient({ gatewayUrl, token });
const turn = await gateway.generate([{ role: "user", text: prompt }], { maxTokens: 512 });
console.log(turn.text ?? JSON.stringify(turn, null, 2));
if (turn.usage) console.error(`\n[metered: ${JSON.stringify(turn.usage)}]`);
