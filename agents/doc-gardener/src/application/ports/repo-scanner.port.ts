export interface RepoScannerPort {
  cloneRepo(repoUrl: string, destDir: string): Promise<void>;
  listFiles(workDir: string): Promise<string[]>;
  readFile(workDir: string, filePath: string): Promise<string | null>;
  writeFile(workDir: string, filePath: string, content: string): Promise<void>;
  createBranch(workDir: string, branchName: string): Promise<void>;
  commitAndPush(workDir: string, branch: string, message: string): Promise<void>;
  getModifiedFiles(workDir: string): Promise<string[]>;
}
