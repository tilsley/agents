import { Hono } from "hono";
import { Webhooks } from "@octokit/webhooks";
import type { HandleWebhook, WebhookPayload } from "../../application/use-cases/handle-webhook";

export interface ConductorWebhookServerConfig {
  webhookSecret: string;
  handleWebhook: HandleWebhook;
}

export function createConductorWebhookServer(
  config: ConductorWebhookServerConfig
): Hono {
  const { webhookSecret, handleWebhook } = config;
  const webhooks = new Webhooks({ secret: webhookSecret });

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/webhook", async (c) => {
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const event = c.req.header("x-github-event") ?? "";
    const body = await c.req.text();

    const isValid = await webhooks.verify(body, signature);
    if (!isValid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    const raw = JSON.parse(body) as {
      action: string;
      check_run?: {
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        head_sha: string;
        output: {
          title: string | null;
          summary: string | null;
          text: string | null;
        };
      };
      pull_request?: {
        number: number;
        head: { sha: string };
        user: { login: string };
        title: string;
      };
      repository: {
        owner: { login: string };
        name: string;
      };
    };

    const payload: WebhookPayload = {
      action: raw.action,
      eventType: event,
      checkRun: raw.check_run
        ? {
            id: raw.check_run.id,
            name: raw.check_run.name,
            status: raw.check_run.status,
            conclusion: raw.check_run.conclusion,
            headSha: raw.check_run.head_sha,
            output: raw.check_run.output,
          }
        : undefined,
      pullRequest: raw.pull_request
        ? {
            number: raw.pull_request.number,
            headSha: raw.pull_request.head.sha,
            prAuthor: raw.pull_request.user.login,
            prTitle: raw.pull_request.title,
          }
        : undefined,
      repository: {
        owner: raw.repository.owner.login,
        name: raw.repository.name,
      },
    };

    const result = await handleWebhook.execute(payload);

    if (!result) {
      return c.json({ status: "ignored", event });
    }

    return c.json({ status: "processing", eventType: result.type });
  });

  return app;
}
