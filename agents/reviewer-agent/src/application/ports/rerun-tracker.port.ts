export interface RerunTrackerPort {
  getCount(key: string): number;
  increment(key: string): number;
}
