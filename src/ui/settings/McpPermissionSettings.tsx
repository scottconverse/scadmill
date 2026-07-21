import type { McpPermission, McpToolPermissionState } from "../../application/mcp/mcp-tools";
import { messages } from "../../messages/en";

export interface McpPermissionSettingsProps {
  readonly enabled: boolean;
  readonly permissions: McpToolPermissionState;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onPermissionChange: (tool: "write_file" | "set_parameters", permission: McpPermission) => void;
}

function PermissionSelect({ label, tool, permissions, onChange }: {
  readonly label: string;
  readonly tool: "write_file" | "set_parameters";
  readonly permissions: McpToolPermissionState;
  readonly onChange: McpPermissionSettingsProps["onPermissionChange"];
}) {
  return <label className="setting-row"><span>{label}</span><select aria-label={label} value={permissions[tool]} onChange={(event) => onChange(tool, event.currentTarget.value as McpPermission)}><option value="allow-once">{messages.mcpPermissionAllowOnce}</option><option value="allow-session">{messages.mcpPermissionAllowSession}</option><option value="deny">{messages.mcpPermissionDeny}</option></select></label>;
}

export function McpPermissionSettings({ enabled, permissions, onEnabledChange, onPermissionChange }: McpPermissionSettingsProps) {
  return <>
    <label className="setting-row"><span>{messages.mcpServerEnabled}</span><input aria-label={messages.mcpServerEnabled} checked={enabled} onChange={(event) => onEnabledChange(event.currentTarget.checked)} type="checkbox" /></label>
    <PermissionSelect label={messages.mcpWritePermission} tool="write_file" permissions={permissions} onChange={onPermissionChange} />
    <PermissionSelect label={messages.mcpParametersPermission} tool="set_parameters" permissions={permissions} onChange={onPermissionChange} />
  </>;
}
