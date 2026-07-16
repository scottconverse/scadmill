export interface WasmWorkflowContract {
  requiredPaths: readonly string[];
  artifactPaths: readonly string[];
  uploadAction: string;
  checkoutAction: string;
  requiredSourceCommit: string;
  requiredVersion: string;
  requiredImage: string;
}

export interface ValidatedWasmWorkflow {
  on: {
    workflow_dispatch: unknown;
    pull_request: {
      paths: string[];
    };
  };
  jobs: {
    detector: { outputs: { should_build: string } };
    build: { needs: string; if: string };
  };
  [key: string]: unknown;
}

export function validateWasmWorkflow(source: string, engineVersionSource: string): ValidatedWasmWorkflow;

export const wasmWorkflowContract: WasmWorkflowContract;
