export interface CodeSnapshot {
  entryPoints: Array<{ file: string; purpose: string }>;
  scripts: Array<{ name: string; command: string; purpose: string }>;
  envVars: Array<{ name: string; usedIn: string; purpose: string }>;
  architecturalFacts: string[];
  configSummary: Array<{ file: string; role: string }>;
  summary: string;
}
