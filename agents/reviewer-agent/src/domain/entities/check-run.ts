export interface CheckRunOutput {
  title: string | null;
  summary: string | null;
  text: string | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  output: CheckRunOutput;
}
