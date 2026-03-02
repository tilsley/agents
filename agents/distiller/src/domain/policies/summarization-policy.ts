import type { Lesson } from "@tilsley/shared";

export function shouldIncludeLesson(lesson: Lesson): boolean {
  if (!lesson.problem || lesson.problem.trim().length === 0) return false;
  if (!lesson.solution || lesson.solution.trim().length === 0) return false;
  return true;
}

export function deduplicateLessons(lessons: Lesson[]): Lesson[] {
  const seen = new Set<string>();
  return lessons.filter((lesson) => {
    const key = `${lesson.problem.toLowerCase().trim()}::${lesson.solution.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getIncludedContext(
  reviewScore: number,
  failureCount: number
): string[] {
  const items: string[] = ["pr_title", "pr_body"];

  if (failureCount > 0) {
    items.push("failure_signatures", "failure_resolutions");
  }

  if (reviewScore < 80) {
    items.push("review_feedback", "review_scores");
  }

  items.push("diff_summary");
  return items;
}
