import type { ChatCompletionPort } from "@tilsley/shared";
import type {
  FeedbackClassifierLlmPort,
  FeedbackClassification,
} from "../../application/ports/feedback-classifier-llm.port";

export class CopilotFeedbackClassifierAdapter implements FeedbackClassifierLlmPort {
  constructor(private chat: ChatCompletionPort) {}

  async classify(commentBody: string, prBody: string): Promise<FeedbackClassification> {
    const systemPrompt = `You are a feedback classifier for an automated CI/CD platform. Your job is to determine whether a human's comment on an automated PR contains a reusable rule that should be remembered for future runs.

Rules are actionable constraints like:
- "Always document environment variables in a table format"
- "Don't document internal helpers"
- "Never upgrade past major version N"
- "Use JSDoc instead of markdown for API docs"

NOT rules: casual remarks, questions, approvals ("LGTM"), specific one-off fixes.

Respond with JSON:
{
  "isRule": boolean,
  "ruleText": "the extracted rule as a clear imperative statement",
  "ruleType": "documentation" | "upgrade-constraint" | "code-style",
  "scope": "global" | "repo",
  "reasoning": "brief explanation of your classification"
}

If isRule is false, set ruleText to "" and ruleType to "documentation".`;

    const userPrompt = `PR Description:
${prBody.slice(0, 2000)}

Human Comment:
${commentBody}

Classify this comment.`;

    return this.chat.completeJson<FeedbackClassification>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  }
}
