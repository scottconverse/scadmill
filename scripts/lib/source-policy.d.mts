export interface SourcePolicyViolation {
  file: string;
  rule: "ui-file-length" | "platform-boundary" | "hardcoded-color";
  message: string;
}

export function scanSourcePolicy(root: string): Promise<SourcePolicyViolation[]>;
