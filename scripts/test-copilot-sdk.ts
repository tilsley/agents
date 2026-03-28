/**
 * Minimal diagnostic: does the Copilot SDK work at all with our setup?
 *
 * Usage:
 *   GITHUB_TOKEN=<token> bun scripts/test-copilot-sdk.ts
 *   GITHUB_TOKEN=<token> bun scripts/test-copilot-sdk.ts --with-tools
 */
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function getNativeCopilotCliPath(): string {
  const sdkPkg = createRequire(import.meta.url).resolve("@github/copilot-sdk/package.json");
  const copilotPkg = createRequire(sdkPkg).resolve("@github/copilot/package.json");
  const platformPkg = `@github/copilot-${process.platform}-${process.arch}`;
  const platformPkgJson = createRequire(copilotPkg).resolve(`${platformPkg}/package.json`);
  return join(dirname(platformPkgJson), "copilot" + (process.platform === "win32" ? ".exe" : ""));
}

const token = process.env.GITHUB_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN;
if (!token) {
  console.error("Set GITHUB_TOKEN or COPILOT_GITHUB_TOKEN");
  process.exit(1);
}

const withTools = process.argv.includes("--with-tools");
const model = process.argv.find((a) => a.startsWith("--model="))?.split("=")[1] ?? "claude-sonnet-4.6";
const cliPath = getNativeCopilotCliPath();
console.log(`CLI path: ${cliPath}`);
console.log(`Model: ${model}`);
console.log(`Tools: ${withTools ? "yes" : "no"}`);

const client = new CopilotClient({ cliPath });

console.log("\n--- Starting client ---");
await client.start();
console.log("Client started");

const tools = withTools
  ? [
      defineTool("echo", {
        description: "Echo back the input",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        handler: async (args: Record<string, unknown>) => {
          console.log(`  [tool:echo] called with: ${JSON.stringify(args)}`);
          return `You said: ${args.text}`;
        },
      }),
    ]
  : undefined;

const sessionConfig: Record<string, unknown> = {
  model,
  githubToken: token,
  systemMessage: { content: "You are a helpful assistant. Be brief." },
};

if (tools) {
  sessionConfig.tools = tools;
  sessionConfig.availableTools = tools.map((t) => t.name);
}

console.log("\n--- Creating session ---");
console.log("Config:", JSON.stringify({ ...sessionConfig, githubToken: "<redacted>", tools: tools ? `[${tools.length} tools]` : undefined }, null, 2));

const session = await client.createSession(sessionConfig as any);
console.log(`Session created: ${session.sessionId}`);

// Log ALL events
session.on((event) => {
  const data = JSON.stringify(event.data, null, 2);
  const preview = data.length > 500 ? data.slice(0, 500) + "…" : data;
  console.log(`\n[event:${event.type}] ${preview}`);
});

const prompt = withTools
  ? 'Call the echo tool with the text "hello world", then respond with what it returned.'
  : "What is 2 + 2? Answer in one word.";

console.log(`\n--- Sending: "${prompt}" ---`);

try {
  const result = await session.sendAndWait({ prompt }, 120_000);
  console.log(`\n--- Result ---`);
  console.log(`Content: ${result?.data?.content ?? "(empty)"}`);
} catch (err) {
  console.error(`\n--- Error ---`);
  console.error(err);
}

console.log("\n--- Cleaning up ---");
await session.destroy();
await client.stop();
console.log("Done");
