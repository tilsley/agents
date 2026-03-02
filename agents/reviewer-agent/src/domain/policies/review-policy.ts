const FAILED_CONCLUSIONS = new Set(["failure", "timed_out"]);

export function isBotPr(author: string, botUsername: string): boolean {
  return author === botUsername;
}

export function isFailedCheck(conclusion: string | null): boolean {
  if (conclusion === null) return false;
  return FAILED_CONCLUSIONS.has(conclusion);
}

export function shouldProcess(
  author: string,
  botUsername: string,
  conclusion: string | null
): boolean {
  return isBotPr(author, botUsername) && isFailedCheck(conclusion);
}
