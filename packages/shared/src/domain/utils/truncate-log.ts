export interface TruncateLogOptions {
  maxLength?: number;
  headRatio?: number;
  separator?: string;
}

export function truncateLog(
  text: string,
  options: TruncateLogOptions = {}
): string {
  const {
    maxLength = 3000,
    headRatio = 0.33,
    separator = "\n\n... [truncated] ...\n\n",
  } = options;

  if (text.length <= maxLength) {
    return text;
  }

  const budget = maxLength - separator.length;
  const headLength = Math.floor(budget * headRatio);
  const tailLength = budget - headLength;

  return text.slice(0, headLength) + separator + text.slice(-tailLength);
}
