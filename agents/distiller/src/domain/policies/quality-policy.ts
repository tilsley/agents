import type { Lesson } from "@tilsley/shared";

const MIN_PROBLEM_LENGTH = 10;
const MIN_SOLUTION_LENGTH = 10;
const MIN_TAGS = 1;

export function meetsQualityThreshold(lesson: Lesson): boolean {
  if (lesson.problem.trim().length < MIN_PROBLEM_LENGTH) return false;
  if (lesson.solution.trim().length < MIN_SOLUTION_LENGTH) return false;
  if (lesson.tags.length < MIN_TAGS) return false;
  return true;
}

export function getQualityScore(lesson: Lesson): number {
  let score = 0;

  // Problem description quality
  if (lesson.problem.length >= MIN_PROBLEM_LENGTH) score += 25;
  if (lesson.problem.length >= 30) score += 10;

  // Solution description quality
  if (lesson.solution.length >= MIN_SOLUTION_LENGTH) score += 25;
  if (lesson.solution.length >= 30) score += 10;

  // Has context
  if (lesson.context.trim().length > 0) score += 10;

  // Has outcome
  if (lesson.outcome.trim().length > 0) score += 10;

  // Tags
  if (lesson.tags.length >= MIN_TAGS) score += 5;
  if (lesson.tags.length >= 3) score += 5;

  return score;
}
