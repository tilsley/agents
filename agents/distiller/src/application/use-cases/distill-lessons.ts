import type { MemoryPort } from "@tilsley/shared";
import type { SummarizerLlmPort } from "../ports/summarizer-llm.port";
import type { ConsolidatorLlmPort } from "../ports/consolidator-llm.port";
import type { ConductorPort } from "../ports/conductor.port";
import type { PipelineSummary } from "../../domain/entities/pipeline-summary";
import type { DistillationResult } from "../../domain/entities/distillation-result";
import {
  shouldIncludeLesson,
  deduplicateLessons,
} from "../../domain/policies/summarization-policy";
import { meetsQualityThreshold } from "../../domain/policies/quality-policy";
import { formatLessonForStorage } from "../../domain/utils/format-lesson";
import type { MemoryDocument, Lesson } from "@tilsley/shared";

function docToLesson(doc: MemoryDocument): Lesson {
  const extract = (field: string) =>
    doc.content.match(new RegExp(`${field}: (.+)`))?.[1]?.trim() ?? "";
  return {
    problem: extract("Problem"),
    solution: extract("Solution"),
    context: extract("Context"),
    outcome: extract("Outcome"),
    tags: [],
    metadata: doc.metadata,
  };
}

export interface DistillLessonsInput {
  summary: PipelineSummary;
  correlationId: string;
  focus?: string;
  agentType?: string;
}

export class DistillLessons {
  constructor(
    private summarizerLlm: SummarizerLlmPort,
    private consolidatorLlm: ConsolidatorLlmPort,
    private memoryPort: MemoryPort,
    private conductor: ConductorPort
  ) {}

  async execute(input: DistillLessonsInput): Promise<DistillationResult> {
    const { summary, correlationId, focus, agentType = "general" } = input;
    const agentId = agentType;
    const repoName = summary.pullRequest.repo;

    // 1. Summarize via LLM
    const rawLessons = await this.summarizerLlm.summarize(summary, focus);

    // 2. Filter: must have problem + solution
    const includedLessons = rawLessons.filter(shouldIncludeLesson);

    // 3. Deduplicate
    const uniqueLessons = deduplicateLessons(includedLessons);

    // 4. Quality filter
    const qualityLessons = uniqueLessons.filter(meetsQualityThreshold);
    const filteredCount = uniqueLessons.length - qualityLessons.length;

    // 5. Consolidate with existing memory via LLM (skip if nothing new to add)
    if (qualityLessons.length === 0) {
      console.log(`[distiller] Extracted ${rawLessons.length} lessons — nothing to consolidate (${filteredCount} filtered)`);

      await this.conductor.emit({
        type: "distillation.completed",
        payload: {
          owner: summary.pullRequest.owner,
          repo: repoName,
          prNumber: summary.pullRequest.number,
          lessonsStored: 0,
          lessonsFiltered: filteredCount,
        },
        timestamp: new Date(),
        correlationId,
      });

      return { lessons: [], storedCount: 0, filteredCount };
    }

    const repoFilter = { agent: agentId, repo: repoName, type: "lesson" };
    const globalFilter = { agent: agentId, scope: "global", type: "lesson" };

    const [existingRepoDocs, existingGlobalDocs] = await Promise.all([
      this.memoryPort.list({ filter: repoFilter }),
      this.memoryPort.list({ filter: globalFilter }),
    ]);

    const existingRepo = existingRepoDocs.map(docToLesson);
    const existingGlobal = existingGlobalDocs.map(docToLesson);

    const { repo: repoLessons, global: globalLessons } =
      await this.consolidatorLlm.consolidate(
        { repo: existingRepo, global: existingGlobal },
        qualityLessons
      );

    // Only write to a path if there is content to write or content to clear
    const writes: Promise<void>[] = [];
    if (repoLessons.length > 0 || existingRepoDocs.length > 0) {
      writes.push(
        this.memoryPort.replace(repoLessons.map(formatLessonForStorage), repoFilter)
      );
    }
    if (globalLessons.length > 0 || existingGlobalDocs.length > 0) {
      writes.push(
        this.memoryPort.replace(globalLessons.map(formatLessonForStorage), globalFilter)
      );
    }
    await Promise.all(writes);

    const totalStored = repoLessons.length + globalLessons.length;
    const totalExisting = existingRepo.length + existingGlobal.length;
    const addedCount = Math.max(0, totalStored - totalExisting);
    const mergedCount = qualityLessons.length - addedCount;

    console.log(
      `[distiller] Extracted ${rawLessons.length} lessons — ` +
      `repo(${agentId}/${repoName}): ${existingRepo.length}→${repoLessons.length}, ` +
      `global(${agentId}): ${existingGlobal.length}→${globalLessons.length} ` +
      `(${addedCount} added, ${mergedCount} merged/superseded, ${filteredCount} filtered)`
    );

    const allConsolidated = [...repoLessons, ...globalLessons];
    const allExisting = [...existingRepo, ...existingGlobal];
    for (const lesson of allConsolidated) {
      const isNew = !allExisting.some((e) => e.problem === lesson.problem);
      console.log(`  [lesson:${isNew ? "new" : "updated"}] ${lesson.problem}`);
      console.log(`    → ${lesson.solution}`);
      if (lesson.tags.length > 0) console.log(`    tags: ${lesson.tags.join(", ")}`);
    }

    // 6. Emit completion
    await this.conductor.emit({
      type: "distillation.completed",
      payload: {
        owner: summary.pullRequest.owner,
        repo: repoName,
        prNumber: summary.pullRequest.number,
        lessonsStored: totalStored,
        lessonsFiltered: filteredCount,
      },
      timestamp: new Date(),
      correlationId,
    });

    return {
      lessons: allConsolidated,
      storedCount: totalStored,
      filteredCount,
    };
  }
}
