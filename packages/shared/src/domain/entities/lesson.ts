export interface Lesson {
  problem: string;
  solution: string;
  context: string;
  outcome: string;
  tags: string[];
  metadata: Record<string, unknown>;
}
