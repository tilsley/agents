// Domain entities
export type { PullRequest } from "./domain/entities/pull-request";
export type { CheckRun, CheckRunOutput } from "./domain/entities/check-run";
export type {
  FailureSignature,
  FailureCategory,
} from "./domain/entities/failure-signature";
export type {
  ReviewChecklist,
  ChecklistItem,
} from "./domain/entities/review-checklist";
export type { Lesson } from "./domain/entities/lesson";
export type { PipelineContext } from "./domain/entities/pipeline-context";
export type { PolicyRule } from "./domain/entities/policy-rule";
export type {
  RepoTemplate,
  RepoTemplateFile,
  RepoTemplateFileSection,
  RepoTemplateDirectory,
} from "./domain/entities/repo-template";

// Domain utils
export { truncateLog } from "./domain/utils/truncate-log";
export type { TruncateLogOptions } from "./domain/utils/truncate-log";
export { ok, err } from "./domain/utils/result";
export type { Result } from "./domain/utils/result";
export { detectLanguage } from "./domain/utils/detect-language";

// Application ports
export type { GitHubPort, GitHubIssueResult } from "./application/ports/github.port";
export type {
  ChatCompletionPort,
  ChatMessage,
  ToolUseChatCompletionPort,
  ToolDefinition,
  ToolCall,
  ToolExecutor,
  CompleteWithToolsOptions,
  ToolUseMessage,
  AssistantToolCallMessage,
  ToolResultMessage,
  AgentSessionConfig,
  AgentSessionPort,
} from "./application/ports/llm.port";
export type {
  MemoryPort,
  MemoryDocument,
  MemoryQueryOptions,
} from "./application/ports/memory.port";
export type { EventBufferPort } from "./application/ports/event-buffer.port";
export type { OrchestratorPort, EventHandler } from "./application/ports/orchestrator.port";
export type { PolicyPort } from "./application/ports/policy.port";

// Types
export type { PipelineEvent } from "./types/pipeline-event";
export type { AgentTask } from "./types/agent-task";
export type { AgentResult, AgentResultStatus } from "./types/agent-result";
