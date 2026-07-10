export const REQUIRED_ATTESTATION: string;
export function validateProvenanceEntry(entry: unknown, filename: string): string[];
export function validateProvenanceLedger(root: string): Promise<string[]>;
export function validateProvenanceChanges(changeLines: string[]): string[];
