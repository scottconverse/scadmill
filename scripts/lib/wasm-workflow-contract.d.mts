export interface WasmWorkflowContract {
  requiredPaths: readonly string[];
  artifactPaths: readonly string[];
  uploadAction: string;
  requiredSourceCommit: string;
  requiredImage: string;
}

export interface ValidatedWasmWorkflow {
  on: {
    workflow_dispatch: unknown;
    pull_request: {
      paths: string[];
    };
  };
  [key: string]: unknown;
}

export function validateWasmWorkflow(source: string, engineVersionSource: string): ValidatedWasmWorkflow;

export const wasmWorkflowContract: WasmWorkflowContract;
