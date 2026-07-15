import type { ConsoleState } from "../diagnostics/console-state";
import type { EditorCommandOutcome } from "../commands/editor-commands";
import type { KeybindingSettings } from "../commands/default-keybindings";
import type { DocumentSeed, DocumentWorkspaceState } from "../documents/document-workspace";
import type { ParamValue, Quality, RenderResult } from "../engine/contracts";
import type {
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../layout/workspace-layout";
import type { ThemePreference } from "../theme/theme-runtime";
import type { ViewerAction, ViewerState } from "../viewer/viewer-state";
import type { ParameterAction, ParameterState } from "../parameters/parameter-state";
import type { WorkspaceLayoutPersistence } from "./layout-persistence";
import type { RenderingSettings, SettingsState } from "./render-settings";
import type { SettingsPersistence } from "../settings/settings-persistence";
import type { PersistedSettings, SettingsSection } from "../settings/settings-schema";
import type { ArtifactDestination } from "../files/artifact-destination";
import type { ProjectStorage } from "../files/project-file-service";
import type { RecentProjectsPersistence } from "../files/recent-projects";
import type { ProjectCommand, ProjectSessionState } from "../files/project-session";
import type { ProjectFileContent, ProjectSnapshot } from "../files/project-snapshot";
import type {
  WorkspaceAnnotationPersistenceState,
  WorkspaceMetadataPersistence,
} from "../viewer/annotation-persistence";

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
  | { kind: "replace-settings"; origin: CommandOrigin; settings: PersistedSettings }
  | { kind: "restore-settings-section"; origin: CommandOrigin; section: SettingsSection }
  | { kind: "engine-availability-changed"; origin: CommandOrigin; available: boolean }
  | { kind: "editor-command"; origin: CommandOrigin; outcome: EditorCommandOutcome }
  | { kind: "cancel-render"; origin: CommandOrigin }
  | { kind: "clear-console"; origin: CommandOrigin }
  | { kind: "retry-annotation-persistence"; origin: CommandOrigin }
  | { kind: "export-annotation-metadata"; origin: CommandOrigin }
  | { kind: "update-layout"; origin: CommandOrigin; action: WorkspaceLayoutAction }
  | { kind: "update-viewer"; origin: CommandOrigin; action: ViewerAction }
  | { kind: "update-parameters"; origin: CommandOrigin; action: ParameterAction }
  | { kind: "write-parameter-values"; origin: CommandOrigin; documentId: string }
  | { kind: "render-active"; origin: CommandOrigin; quality: Quality };

export interface HistoryEntry {
  commandId: string;
  timestamp: string;
  origin: CommandOrigin;
  kind: WorkbenchCommand["kind"];
  summary: string;
  undoable: boolean;
}

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
}
