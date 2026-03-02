import { CopilotClient } from "@github/copilot-sdk";
import path from "path";
import process from "process";
import fs from "fs";

async function main() {
  // Ensure PAT is provided
  if (!process.env.COPILOT_GITHUB_TOKEN) {
    console.error("❌ Missing COPILOT_GITHUB_TOKEN environment variable");
    process.exit(1);
  }

  // Resolve Copilot CLI path
  const cliPath = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "copilot.cmd" : "copilot"
  );

  if (!fs.existsSync(cliPath)) {
    console.error("❌ Copilot CLI not found at:", cliPath);
    console.error("Did you run: npm install @github/copilot ?");
    process.exit(1);
  }

  console.log("🔍 Using Copilot CLI:", cliPath);

  // Initialize Copilot client in headless mode
  const client = new CopilotClient({
    useLoggedInUser: false, // 🚨 Disables OAuth / browser login
    githubToken: process.env.COPILOT_GITHUB_TOKEN,
    cliPath,
    logLevel: "debug"
  });

  try {
    console.log("🛠️  Starting Copilot Client...");
    await client.start();

    console.log("📡 Creating session...");
    const session = await client.createSession({
      model: "gpt-4.1",
      skipModelValidation: true
    });

    console.log("💬 Sending test prompt...");
    const response = await session.sendAndWait({
      prompt: "Reply with 'Headless mode active' if you can hear me."
    });

    console.log("\n🤖 Copilot Response:");
    console.log(response?.data?.content ?? "(no content)");

    await client.stop();
    console.log("\n✅ Success! Copilot is running in headless mode.");
  } catch (error) {
    console.error("\n❌ Test Failed");
    console.error("Message:", error.message);

    if (error.code) {
      console.error("Code:", error.code);
    }

    process.exit(1);
  }
}

main();
