import type { DocClaim } from "../../domain/entities/doc-claim";

export interface DocAnalyzerLlmPort {
  extractClaims(docContent: string, filePath: string): Promise<DocClaim[]>;
}
