/**
 * Builds the GitHub releases URL range for fetching the changelog.
 * Returns null if the package name cannot be mapped to a GitHub repo.
 */
export function buildChangelogUrl(packageName: string): string | null {
  // Well-known mappings for common packages
  const KNOWN_REPOS: Record<string, string> = {
    "aws-cdk-lib": "aws/aws-cdk",
    "react": "facebook/react",
    "typescript": "microsoft/TypeScript",
    "next": "vercel/next.js",
    "express": "expressjs/express",
    "hono": "honojs/hono",
    "vite": "vitejs/vite",
  };

  const repo = KNOWN_REPOS[packageName];
  if (!repo) return null;
  return `https://github.com/${repo}/releases`;
}
