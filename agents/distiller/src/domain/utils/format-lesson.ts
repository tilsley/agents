import type { Lesson, MemoryDocument } from "@tilsley/shared";

export function formatLessonForStorage(lesson: Lesson): MemoryDocument {
  const content = [
    `Problem: ${lesson.problem}`,
    `Solution: ${lesson.solution}`,
    `Context: ${lesson.context}`,
    `Outcome: ${lesson.outcome}`,
  ]
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  return {
    id: generateLessonId(lesson),
    content,
    metadata: {
      type: "lesson",
      tags: lesson.tags,
      ...lesson.metadata,
    },
  };
}

export function formatLessonSummary(lessons: Lesson[]): string {
  if (lessons.length === 0) return "No lessons extracted.";

  return lessons
    .map(
      (l, i) =>
        `${i + 1}. **${l.problem}** → ${l.solution} [${l.tags.join(", ")}]`
    )
    .join("\n");
}

function generateLessonId(lesson: Lesson): string {
  const hash = simpleHash(
    `${lesson.problem}::${lesson.solution}::${lesson.context}`
  );
  return `lesson-${hash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}
