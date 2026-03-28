export interface DocClaim {
  section: string;
  claim: string;
  category:
    | "setup"
    | "usage"
    | "config"
    | "architecture"
    | "api"
    | "deployment"
    | "other";
  sourceText: string;
}
