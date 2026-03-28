export interface RepoTemplateFileSection {
  heading: string;
  required: boolean;
  description?: string;
}

export interface RepoTemplateFile {
  path: string;
  required: boolean;
  sections?: RepoTemplateFileSection[];
  constraints?: string[];
}

export interface RepoTemplateDirectory {
  path: string;
  required: boolean;
  filePattern?: string;
  formatDescription?: string;
}

export interface RepoTemplate {
  name: string;
  description?: string;
  files: RepoTemplateFile[];
  directories?: RepoTemplateDirectory[];
}
