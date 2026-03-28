export interface ReadmeSection {
  heading: string;
  level: number;
  content: string;
  startLine: number;
}

/**
 * Splits a README into sections by markdown headings.
 * Each section includes the heading and all content until the next heading of equal or higher level.
 */
export function parseReadme(content: string): ReadmeSection[] {
  const lines = content.split("\n");
  const sections: ReadmeSection[] = [];
  let current: ReadmeSection | null = null;
  const contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)/);

    if (match) {
      // Flush previous section
      if (current) {
        current.content = contentLines.join("\n").trim();
        sections.push(current);
        contentLines.length = 0;
      }

      current = {
        heading: match[2].trim(),
        level: match[1].length,
        content: "",
        startLine: i + 1,
      };
    } else if (current) {
      contentLines.push(line);
    }
  }

  // Flush last section
  if (current) {
    current.content = contentLines.join("\n").trim();
    sections.push(current);
  }

  return sections;
}

/**
 * Extracts the raw text content from a README (strips markdown formatting for search).
 */
export function readmeText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, "")  // strip code blocks
    .replace(/`[^`]+`/g, "")          // strip inline code
    .toLowerCase();
}
