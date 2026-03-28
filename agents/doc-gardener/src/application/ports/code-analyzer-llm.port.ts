import type { CodeSnapshot } from "../../domain/entities/code-snapshot";
import type { RepoInventory } from "../../domain/policies/drift-detection-policy";

export interface SourceFile {
  path: string;
  content: string;
}

export interface CodeAnalyzerLlmPort {
  analyzeCode(
    sourceFiles: SourceFile[],
    inventory: RepoInventory
  ): Promise<CodeSnapshot>;
}
