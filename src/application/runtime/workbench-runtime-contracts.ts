import type { KeybindingSettings } from "../commands/default-keybindings";
import type { EditorCommandOutcome } from "../commands/editor-commands";
import type { ConsoleState } from "../diagnostics/console-state";
import type { DocumentSeed, DocumentWorkspaceState } from "../documents/document-workspace";
import type { ParamValue, Quality, RenderResult } from "../engine/contracts";
import type { ArtifactDestination } from "../files/artifact-destination";
import type { ProjectStorage } from "../files/project-file-service";
import type { ProjectCommand, ProjectSessionState } from "../files/project-session";
import type { ProjectFileContent, ProjectSnapshot } from "../files/project-snapshot";
import type { RecentProjectsPersistence } from "../files/recent-projects";
import type { McpPermission, McpToolName } from "../mcp/mcp-tools";
import type {
  ModelHistoryPersistence,
  ModelHistoryPersistenceState,
  ModelHistorySnapshot,
} from "../model-history/model-history";
import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../layout/workspace-layout";
import type { ParameterAction, ParameterState } from "../parameters/parameter-state";
import type { RenderCache } from "../render-cache/render-cache";
import type { RenderDiskCachePreferencePersistence } from "../render-cache/render-cache-preference";
import type { RenderDiskCacheStorage } from "../render-cache/render-disk-cache";
import type { RenderThumbnailPersistence } from "../render-cache/render-thumbnail-persistence";
import type { SettingsPersistence } from "../settings/settings-persistence";
import type { PersistedSettings, SettingsSection } from "../settings/settings-schema";
import type { ThemePreference } from "../theme/theme-runtime";
import type {
  WorkspaceAnnotationPersistenceState,
  WorkspaceMetadataPersistence,
} from "../viewer/annotation-persistence";
import type { ViewerAction, ViewerState } from "../viewer/viewer-state";
import type { CameraBookmarkPersistence } from "../viewer/camera-bookmarks";
import type { WorkspaceLayoutPersistence } from "./layout-persistence";
import type { RenderingSettings, SettingsState } from "./render-settings";
import type { WorkbenchControlState } from "./workbench-controls";
import type { WelcomePreferencePersistence } from "../welcome/welcome-preference";

export type CommandOrigin = "user" | "ai-panel" | "external-agent" | "system";

export interface RenderState {
  status: "idle" | "rendering" | "success" | "failure";
  jobId?: string;
  startedAtMs?: number;
  startedAtMonotonicMs?: number;
  quality?: Quality;
  documentId?: string;
  entryFile?: string;
  sourceRevision?: number;
  sourceFiles?: ReadonlyMap<string, ProjectFileContent>;
  projectRevision?: number;
  parameterValues?: Readonly<Record<string, ParamValue>>;
  result?: RenderResult;
  cached?: boolean;
  presentationToken?: string;
}

export type WorkbenchCommand =
  | (ProjectCommand & { readonly origin: CommandOrigin })
  | { kind: "open-document"; origin: CommandOrigin; document: DocumentSeed }
  | { kind: "activate-document"; origin: CommandOrigin; documentId: string }
  | { kind: "edit-document"; origin: CommandOrigin; documentId: string; source: string }
  | {
      kind: "mark-document-autosaved";
      origin: CommandOrigin;
      documentId: string;
      revision: number;
      source: string;
    }
  | {
      kind: "resolve-external-change";
      origin: CommandOrigin;
      documentId: string;
      diskSource: string;
      choice: "reload" | "keep";
    }
  | { kind: "move-document"; origin: CommandOrigin; documentId: string; toIndex: number }
  | { kind: "close-document"; origin: CommandOrigin; documentId: string }
  | { kind: "reopen-document"; origin: CommandOrigin }
  | { kind: "set-theme"; origin: CommandOrigin; theme: ThemePreference }
  | { kind: "set-auto-render"; origin: CommandOrigin; enabled: boolean }
  | { kind: "set-welcome-on-launch"; origin: CommandOrigin; enabled: boolean }
  | { kind: "set-mcp-enabled"; origin: CommandOrigin; enabled: boolean }
  | {
      kind: "set-mcp-permission";
      origin: CommandOrigin;
      tool: McpToolName;
      permission: McpPermission;
    }
  | { kind: "set-project-disk-render-cache"; origin: CommandOrigin; enabled: boolean }
  | { kind: "clear-project-disk-render-cache"; origin: CommandOrigin }
  | { kind: "replace-settings"; origin: CommandOrigin; settings: PersistedSettings }
  | { kind: "restore-settings-section"; origin: CommandOrigin; section: SettingsSection }
  | { kind: "engine-availability-changed"; origin: CommandOrigin; available: boolean }
  | { kind: "editor-command"; origin: CommandOrigin; outcome: EditorCommandOutcome }
  | { kind: "cancel-render"; origin: CommandOrigin }
  | { kind: "cancel-animation"; origin: CommandOrigin }
  | { kind: "clear-console"; origin: CommandOrigin }
  | { kind: "retry-annotation-persistence"; origin: CommandOrigin }
  | { kind: "export-annotation-metadata"; origin: CommandOrigin }
  | { kind: "update-layout"; origin: CommandOrigin; action: WorkspaceLayoutAction }
  | { kind: "update-viewer"; origin: CommandOrigin; action: ViewerAction }
  | { kind: "update-parameters"; origin: CommandOrigin; action: ParameterAction }
  | { kind: "write-parameter-values"; origin: CommandOrigin; documentId: string }
  | { kind: "history-undo"; origin: CommandOrigin }
  | { kind: "history-redo"; origin: CommandOrigin }
  | { kind: "restore-model-history-snapshot"; origin: CommandOrigin; snapshotId: string }
  | {
      kind: "set-project-model-history-persistence";
      origin: CommandOrigin;
      enabled: boolean;
    }
  | {
      kind: "attach-model-history-thumbnail";
      origin: "system";
      workspaceIdentity: string;
      snapshotId: string;
      pngBytes: Uint8Array;
    }
  | {
      kind: "render-active";
      origin: CommandOrigin;
      quality: Quality;
      animationTime?: number;
    };

export interface HistoryEntry {
  commandId: string;
  timestamp: string;
  origin: CommandOrigin;
  kind: WorkbenchCommand["kind"];
  summary: string;
  undoable: boolean;
}

export type HistoryDetail = {
  readonly kind: "source-diff";
  readonly path: string;
  readonly before: string;
  readonly after: string;
};

export interface ReadonlyStore<T> {
  getState(): T;
  getInitialState(): T;
  subscribe(listener: (state: T, previousState: T) => void): () => void;
}

export interface WorkbenchRuntime {
  artifacts: ArtifactDestination;
  documents: ReadonlyStore<DocumentWorkspaceState>;
  render: ReadonlyStore<RenderState>;
  console: ReadonlyStore<ConsoleState>;
  settings: ReadonlyStore<SettingsState>;
  layout: ReadonlyStore<WorkspaceLayoutState>;
  viewer: ReadonlyStore<ViewerState>;
  annotationPersistence: ReadonlyStore<WorkspaceAnnotationPersistenceState>;
  parameters: ReadonlyStore<ParameterState>;
  project: ReadonlyStore<ProjectSessionState>;
  history: ReadonlyStore<readonly HistoryEntry[]>;
  historyDetails: ReadonlyStore<ReadonlyMap<string, HistoryDetail>>;
  modelHistory: ReadonlyStore<readonly ModelHistorySnapshot[]>;
  modelHistoryPersistence: ReadonlyStore<ModelHistoryPersistenceState>;
  controls: ReadonlyStore<WorkbenchControlState>;
  readonly renderThumbnails: RenderThumbnailPersistence;
  readonly cameraBookmarks: CameraBookmarkPersistence;
  dispatch(command: WorkbenchCommand): Promise<void>;
  dispose(): void;
}

export interface RuntimeOptions {
  artifactDestination?: ArtifactDestination;
  makeId?: () => string;
  now?: () => Date;
  nowMs?: () => number;
  layoutPersistence?: WorkspaceLayoutPersistence;
  settingsPersistence?: SettingsPersistence;
  rendering?: Partial<RenderingSettings>;
  keybindings?: Partial<KeybindingSettings>;
  projectStorage?: ProjectStorage;
  initialProject?: ProjectSnapshot;
  recentProjectsPersistence?: RecentProjectsPersistence;
  workspaceMetadataPersistence?: WorkspaceMetadataPersistence;
  initialScratchSource?: string;
  initialScratchPath?: string;
  renderCache?: RenderCache | null;
  renderDiskCacheStorage?: RenderDiskCacheStorage;
  renderDiskCachePreferencePersistence?: RenderDiskCachePreferencePersistence;
  renderThumbnailPersistence?: RenderThumbnailPersistence;
  modelHistoryPersistence?: ModelHistoryPersistence;
  cameraBookmarkPersistence?: CameraBookmarkPersistence;
  welcomePreferencePersistence?: WelcomePreferencePersistence;
}
