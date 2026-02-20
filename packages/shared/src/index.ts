/**
 * @tilsley/shared — barrel export
 *
 * This package will contain domain entities, application ports, and utility
 * types shared across the multi-agent platform.
 *
 * Nothing is exported yet. As the platform matures, common abstractions
 * will be extracted from individual agents (starting with reviewer-agent)
 * and re-exported here. Candidate extractions:
 *
 *   - Domain entities: PullRequest, CheckRun, ReviewResult
 *   - Application ports: GitHubPort, LlmPort
 *   - Utility types: Result<T, E>, branded IDs
 */
