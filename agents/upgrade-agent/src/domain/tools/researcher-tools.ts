import type { ToolDefinition, ToolExecutor } from "@tilsley/shared";
import type { UpgradeGitPort } from "../../application/ports/upgrade-git.port";
import * as fs from "fs/promises";
import * as path from "path";

const MAX_FILE_CHARS = 15_000;
const MAX_GREP_MATCHES = 50;
const MAX_GREP_FILES = 100;

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", ".cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".txt", ".env", ".env.example",
  ".css", ".scss", ".html", ".svg",
  ".sh", ".bash",
  ".lock",       // bun.lock, package-lock.json, etc.
  ".config.ts", ".config.js", ".config.mjs",
]);

/** Recursively list all text files in the repo, excluding build artifacts. */
async function listRepoFiles(workDir: string, subDir = ""): Promise<string[]> {
  const fullPath = subDir ? path.join(workDir, subDir) : workDir;
  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const relative = subDir ? `${subDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await listRepoFiles(workDir, relative)));
    } else if (entry.isFile()) {
      // Include if extension matches, or if it's a dotfile/config with no extension
      const ext = path.extname(entry.name);
      const nameWithoutExt = path.basename(entry.name, ext);
      if (
        TEXT_EXTENSIONS.has(ext) ||
        entry.name.endsWith(".config.ts") ||
        entry.name.endsWith(".config.js") ||
        entry.name.endsWith(".config.mjs") ||
        (entry.name.startsWith(".") && ext === "") // dotfiles like .eslintrc
      ) {
        files.push(relative);
      }
    }
  }

  return files;
}

export const RESEARCHER_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file in the target repository. Works for any file — source code, config, package.json, etc.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative path from the repository root (e.g. 'src/server.ts', 'package.json', 'tsconfig.json')",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a regex pattern across all files in the repository (source, config, JSON, etc.). Returns matching lines with ±1 line of context, grouped by file. Excludes node_modules, dist, and build artifacts.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regular expression pattern to search for",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List all files in the repository (source, config, JSON, etc.), optionally filtered to a directory prefix. Excludes node_modules, dist, and build artifacts.",
      parameters: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description:
              "Optional directory prefix to filter results (e.g. 'src', 'apps/ui'). Omit to list all files.",
          },
        },
      },
    },
  },
];

export function createResearcherToolExecutor(
  workDir: string,
  git: UpgradeGitPort
): ToolExecutor {
  return {
    read_file: async (args) => {
      const filePath = String(args.path ?? "");
      if (!filePath) return "Error: path is required";

      try {
        let content = await git.readFile(workDir, filePath);
        if (content.length > MAX_FILE_CHARS) {
          content =
            content.slice(0, MAX_FILE_CHARS) +
            `\n\n… (truncated at ${MAX_FILE_CHARS} chars, total ${content.length})`;
        }
        return content;
      } catch {
        return `Error: file not found — ${filePath}`;
      }
    },

    grep: async (args) => {
      const pattern = String(args.pattern ?? "");
      if (!pattern) return "Error: pattern is required";

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch {
        return `Error: invalid regex pattern — ${pattern}`;
      }

      const files = await listRepoFiles(workDir);
      const results: string[] = [];
      let totalMatches = 0;
      let filesSearched = 0;

      for (const file of files) {
        if (filesSearched >= MAX_GREP_FILES || totalMatches >= MAX_GREP_MATCHES) break;
        filesSearched++;

        let content: string;
        try {
          content = await git.readFile(workDir, file);
        } catch {
          continue;
        }

        const lines = content.split("\n");
        const fileMatches: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (totalMatches >= MAX_GREP_MATCHES) break;

          if (regex.test(lines[i])) {
            totalMatches++;
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length - 1, i + 1);
            const snippet = lines
              .slice(start, end + 1)
              .map((l, idx) => {
                const lineNum = start + idx + 1;
                const marker = start + idx === i ? ">" : " ";
                return `${marker} ${lineNum}: ${l}`;
              })
              .join("\n");
            fileMatches.push(snippet);
          }
        }

        if (fileMatches.length > 0) {
          results.push(`--- ${file} ---\n${fileMatches.join("\n\n")}`);
        }
      }

      if (results.length === 0) return "No matches found.";
      return results.join("\n\n");
    },

    list_files: async (args) => {
      const directory = args.directory ? String(args.directory) : undefined;
      const files = await listRepoFiles(workDir);

      const filtered = directory
        ? files.filter((f) => f.startsWith(directory))
        : files;

      if (filtered.length === 0) {
        return directory
          ? `No files found under "${directory}".`
          : "No files found.";
      }

      return filtered.join("\n");
    },
  };
}
