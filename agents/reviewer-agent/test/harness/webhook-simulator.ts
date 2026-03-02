import { createHmac } from "crypto";
import { resolve } from "path";

const DEFAULT_FIXTURE = resolve(
  import.meta.dir,
  "fixtures/check-run-completed.json"
);

async function main() {
  const fixturePath = process.argv[2] ?? DEFAULT_FIXTURE;
  const targetUrl = process.argv[3] ?? "http://localhost:3000/webhook";
  const secret = process.env["GITHUB_WEBHOOK_SECRET"] ?? "development-secret";

  const payload = await Bun.file(fixturePath).text();

  const signature =
    "sha256=" +
    createHmac("sha256", secret).update(payload).digest("hex");

  console.log(`Sending check_run.completed event to ${targetUrl}`);
  console.log(`Fixture: ${fixturePath}`);
  console.log(`Signature: ${signature.slice(0, 20)}...`);

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "check_run",
      "X-Hub-Signature-256": signature,
      "X-GitHub-Delivery": crypto.randomUUID(),
    },
    body: payload,
  });

  const body = await response.json();
  console.log(`Response: ${response.status}`, body);
}

main().catch((err) => {
  console.error("Simulator error:", err);
  process.exit(1);
});
