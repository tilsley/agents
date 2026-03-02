export function shouldEscalateRetry(count: number, max: number): boolean {
  return count >= max;
}
