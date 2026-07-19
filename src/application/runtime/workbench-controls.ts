import {
  DEFAULT_MCP_PERMISSIONS,
  type McpPermission,
  type McpToolName,
  type McpToolPermissionState,
} from "../mcp/mcp-tools";

export interface WorkbenchControlState {
  readonly showWelcomeOnLaunch: boolean;
  readonly mcpEnabled: boolean;
  readonly mcpPermissions: McpToolPermissionState;
}

export type WorkbenchControlAction =
  | { readonly kind: "set-welcome-on-launch"; readonly enabled: boolean }
  | { readonly kind: "set-mcp-enabled"; readonly enabled: boolean }
  | {
      readonly kind: "set-mcp-permission";
      readonly tool: McpToolName;
      readonly permission: McpPermission;
    };

export function createWorkbenchControlState(showWelcomeOnLaunch = false): WorkbenchControlState {
  return {
    showWelcomeOnLaunch,
    mcpEnabled: false,
    mcpPermissions: { ...DEFAULT_MCP_PERMISSIONS },
  };
}

export function reduceWorkbenchControlState(
  state: WorkbenchControlState,
  action: WorkbenchControlAction,
): WorkbenchControlState {
  switch (action.kind) {
    case "set-welcome-on-launch":
      return state.showWelcomeOnLaunch === action.enabled
        ? state
        : { ...state, showWelcomeOnLaunch: action.enabled };
    case "set-mcp-enabled":
      return state.mcpEnabled === action.enabled
        ? state
        : { ...state, mcpEnabled: action.enabled };
    case "set-mcp-permission":
      return state.mcpPermissions[action.tool] === action.permission
        ? state
        : {
            ...state,
            mcpPermissions: { ...state.mcpPermissions, [action.tool]: action.permission },
          };
  }
}
