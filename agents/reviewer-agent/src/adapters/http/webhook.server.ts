import { Hono } from "hono";
import { Webhooks } from "@octokit/webhooks";
import type {
  HandleCheckRunCompleted,
  CheckRunEvent,
} from "../../application/use-cases/handle-check-run-completed";
import type { HandlePrEval } from "../../application/use-cases/handle-pr-eval";
import type { CheckRun } from "../../domain/entities/check-run";
import type { EventBufferPort } from "../../application/ports/event-buffer.port";

export interface WebhookServerConfig {
  webhookSecret: string;
  useCase: HandleCheckRunCompleted;
  eventBuffer?: EventBufferPort<CheckRunEvent>;
  evalUseCase?: HandlePrEval;
  evalEventBuffer?: EventBufferPort<CheckRunEvent>;
}

export function createWebhookServer(config: WebhookServerConfig): Hono {
  const { webhookSecret, useCase, eventBuffer, evalUseCase, evalEventBuffer } =
    config;
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

    if (event !== "check_run") {
      return c.json({ status: "ignored", event });
    }

    const payload = JSON.parse(body) as {
      action: string;
      check_run: {
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
      repository: {
        owner: { login: string };
        name: string;
      };
    };

    if (payload.action !== "completed") {
      return c.json({ status: "ignored", action: payload.action });
    }

    const cr = payload.check_run;
    const checkRun: CheckRun = {
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
      headSha: cr.head_sha,
      output: {
        title: cr.output.title,
        summary: cr.output.summary,
        text: cr.output.text,
      },
    };

    const owner = payload.repository.owner.login;
    const repo = payload.repository.name;
    const checkRunEvent: CheckRunEvent = { owner, repo, checkRun };

    // Dispatch to failure use case (existing behavior)
    if (eventBuffer) {
      eventBuffer.add(checkRunEvent, (events) =>
        useCase.executeBatch(events)
      );
    } else {
      useCase.execute(checkRunEvent).catch((err) => {
        console.error("[webhook] Error processing check_run event:", err);
      });
    }

    // Dispatch to eval use case on success events
    if (evalUseCase && cr.conclusion === "success") {
      if (evalEventBuffer) {
        evalEventBuffer.add(checkRunEvent, (events) =>
          evalUseCase.executeBatch(events)
        );
      } else {
        evalUseCase.execute(checkRunEvent).catch((err) => {
          console.error("[webhook] Error processing eval event:", err);
        });
      }
    }

    return c.json({ status: "processing" });
  });

  return app;
}
