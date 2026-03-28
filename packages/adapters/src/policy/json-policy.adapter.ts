import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { PolicyPort, PolicyRule } from "@tilsley/shared";

export class JsonPolicyAdapter implements PolicyPort {
  constructor(private baseDir: string = "policies") {
    mkdirSync(join(this.baseDir, "global"), { recursive: true });
  }

  async listRules(opts?: {
    type?: string;
    scope?: string;
    repo?: string;
    active?: boolean;
  }): Promise<PolicyRule[]> {
    const rules: PolicyRule[] = [];

    // Load global rules
    if (!opts?.scope || opts.scope === "global") {
      rules.push(...this.loadDir(join(this.baseDir, "global")));
    }

    // Load repo-specific rules
    if (opts?.repo) {
      const repoDir = join(this.baseDir, "repos", opts.repo);
      if (existsSync(repoDir)) {
        rules.push(...this.loadDir(repoDir));
      }
    }

    // If no repo filter and scope isn't "global", load all repo rules
    if (!opts?.repo && opts?.scope === "repo") {
      const reposDir = join(this.baseDir, "repos");
      if (existsSync(reposDir)) {
        for (const entry of this.listDirs(reposDir)) {
          rules.push(...this.loadDir(join(reposDir, entry)));
        }
      }
    }

    return rules.filter((r) => {
      if (opts?.type && r.type !== opts.type) return false;
      if (opts?.active !== undefined && r.active !== opts.active) return false;
      return true;
    });
  }

  async addRule(
    rule: Omit<PolicyRule, "id" | "createdAt" | "updatedAt">
  ): Promise<PolicyRule> {
    const now = new Date().toISOString();
    const id = createHash("sha256")
      .update(`${rule.rule}:${rule.type}:${rule.scope}:${rule.repoSlug ?? ""}`)
      .digest("hex")
      .slice(0, 12);

    const fullRule: PolicyRule = { ...rule, id, createdAt: now, updatedAt: now };

    const filePath = this.filePathFor(rule.scope, rule.type, rule.repoSlug);
    const existing = this.loadFile(filePath);

    // Deduplicate by id
    const idx = existing.findIndex((r) => r.id === id);
    if (idx >= 0) {
      existing[idx] = fullRule;
    } else {
      existing.push(fullRule);
    }

    this.saveFile(filePath, existing);
    return fullRule;
  }

  async updateRule(
    id: string,
    updates: Partial<Pick<PolicyRule, "active" | "rule" | "confidence">>
  ): Promise<PolicyRule | null> {
    // Search all files for the rule
    const allFiles = this.getAllJsonFiles();

    for (const filePath of allFiles) {
      const rules = this.loadFile(filePath);
      const idx = rules.findIndex((r) => r.id === id);
      if (idx >= 0) {
        const rule = rules[idx];
        if (updates.active !== undefined) rule.active = updates.active;
        if (updates.rule !== undefined) rule.rule = updates.rule;
        if (updates.confidence !== undefined) rule.confidence = updates.confidence;
        rule.updatedAt = new Date().toISOString();
        this.saveFile(filePath, rules);
        return rule;
      }
    }

    return null;
  }

  private filePathFor(scope: string, type: string, repoSlug?: string): string {
    if (scope === "repo" && repoSlug) {
      const dir = join(this.baseDir, "repos", repoSlug);
      mkdirSync(dir, { recursive: true });
      return join(dir, `${type}.json`);
    }
    return join(this.baseDir, "global", `${type}.json`);
  }

  private loadFile(filePath: string): PolicyRule[] {
    if (!existsSync(filePath)) return [];
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as PolicyRule[];
    } catch {
      return [];
    }
  }

  private saveFile(filePath: string, rules: PolicyRule[]): void {
    writeFileSync(filePath, JSON.stringify(rules, null, 2) + "\n", "utf-8");
  }

  private loadDir(dir: string): PolicyRule[] {
    if (!existsSync(dir)) return [];
    const rules: PolicyRule[] = [];
    for (const entry of this.listFiles(dir)) {
      if (entry.endsWith(".json")) {
        rules.push(...this.loadFile(join(dir, entry)));
      }
    }
    return rules;
  }

  private getAllJsonFiles(): string[] {
    const files: string[] = [];

    // Global
    const globalDir = join(this.baseDir, "global");
    if (existsSync(globalDir)) {
      for (const f of this.listFiles(globalDir)) {
        if (f.endsWith(".json")) files.push(join(globalDir, f));
      }
    }

    // Repos
    const reposDir = join(this.baseDir, "repos");
    if (existsSync(reposDir)) {
      for (const repoDir of this.listDirs(reposDir)) {
        const dir = join(reposDir, repoDir);
        for (const f of this.listFiles(dir)) {
          if (f.endsWith(".json")) files.push(join(dir, f));
        }
      }
    }

    return files;
  }

  private listFiles(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }

  private listDirs(dir: string): string[] {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [];
    }
  }
}
