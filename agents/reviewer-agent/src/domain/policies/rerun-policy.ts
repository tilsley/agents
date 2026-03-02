export function shouldEscalateRerun(
  currentCount: number,
  maxReruns: number
): boolean {
  return currentCount >= maxReruns;
}
