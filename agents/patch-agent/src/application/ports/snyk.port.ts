import type { VulnerabilityReport } from "../../domain/entities/vulnerability";

export interface SnykPort {
  /**
   * Scan a project directory and return the vulnerability report.
   * @param workDir - absolute path to the project root (where package.json lives)
   */
  scan(workDir: string): Promise<VulnerabilityReport>;
}
