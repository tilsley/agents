export interface RetryTrackerPort {
  getCount(key: string): number;
  increment(key: string): number;
}

interface TrackerEntry {
  count: number;
  expiresAt: number;
}

export class InMemoryRetryTracker implements RetryTrackerPort {
  private entries = new Map<string, TrackerEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private ttlMs: number = 60 * 60 * 1000) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  static makeKey(
    owner: string,
    repo: string,
    prNumber: number,
    checkName: string,
    headSha: string
  ): string {
    return `${owner}/${repo}#${prNumber}:${checkName}:${headSha}`;
  }

  getCount(key: string): number {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return 0;
    }
    return entry.count;
  }

  increment(key: string): number {
    const existing = this.entries.get(key);
    const now = Date.now();

    if (existing && now <= existing.expiresAt) {
      existing.count += 1;
      return existing.count;
    }

    this.entries.set(key, { count: 1, expiresAt: now + this.ttlMs });
    return 1;
  }

  dispose(): void {
    clearInterval(this.cleanupInterval);
    this.entries.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}
