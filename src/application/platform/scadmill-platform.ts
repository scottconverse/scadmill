import type { EngineService } from "../engine/contracts";
import type { AiFetchFactory } from "../ai/ai-client";
import type { EngineLoadProgressStore } from "../engine/engine-load-progress";
import type { EnginePathConfiguration } from "../engine/engine-path-configuration";
import type { ArtifactDestination } from "../files/artifact-destination";
import type { ProjectStorage } from "../files/project-file-service";
import type { RecentProjectsPersistence } from "../files/recent-projects";
import type { RecoveryPersistence } from "../files/recovery-state";
import type { ScratchAutosavePersistence } from "../files/scratch-autosave";
import type { ImportedProjectStorage } from "../files/workbench-portability";
import type { ProjectDirectoryPicker, WorkspaceDirectory } from "../files/workspace-directory";
import type { RenderDiskCachePreferencePersistence } from "../render-cache/render-cache-preference";
import type { RenderDiskCacheStorage } from "../render-cache/render-disk-cache";
import type { RenderThumbnailPersistence } from "../render-cache/render-thumbnail-persistence";
import type { ModelHistoryPersistence } from "../model-history/model-history";
import type { WorkspaceLayoutPersistence } from "../runtime/layout-persistence";
import type { SecretStore } from "../settings/secret-store";
import type { SettingsPersistence } from "../settings/settings-persistence";
import type { WorkspaceMetadataPersistence } from "../viewer/annotation-persistence";
import type { WelcomePreferencePersistence } from "../welcome/welcome-preference";

export type PlatformFeature<T> =
  | { readonly available: true; readonly service: T }
  | { readonly available: false };

export interface ClipboardPort {
  writeText(value: string): Promise<void>;
}

export interface LocationPort {
  currentHref(): string;
  makeProjectId(): string;
}

export const PLATFORM_MENU_COMMANDS = [
  "file.new",
  "file.open",
  "file.save",
  "file.save-all",
  "file.export",
  "file.close",
  "file.reopen",
  "edit.find",
  "edit.replace",
  "edit.go-to-line",
  "edit.toggle-comment",
  "edit.format-document",
  "edit.format-selection",
  "edit.undo",
  "edit.redo",
  "view.toggle-dock",
  "view.toggle-editor",
  "view.toggle-viewer",
  "view.toggle-parameters",
  "view.toggle-console",
  "view.maximize-editor",
  "view.maximize-viewer",
  "view.reset-layout",
  "render.preview",
  "render.full",
  "help.show",
] as const;

export type PlatformMenuCommand = (typeof PLATFORM_MENU_COMMANDS)[number];

export interface PlatformMenuItemState {
  readonly enabled: boolean;
  readonly checked?: boolean;
  readonly accelerator?: string;
}

export type PlatformMenuState = Readonly<Partial<Record<PlatformMenuCommand, PlatformMenuItemState>>>;

export interface PlatformCommandSource {
  subscribe(listener: (command: PlatformMenuCommand) => void): () => void;
  synchronize(state: PlatformMenuState): Promise<void>;
}

export interface AssociatedFileOpenRequest {
  readonly projectId: string;
  readonly displayName: string;
  readonly entryFile: string;
}

export interface AssociatedFileOpenSource {
  subscribe(listener: (request: AssociatedFileOpenRequest) => void): () => void;
  subscribeErrors(listener: (message: string) => void): () => void;
}

export function isPlatformMenuCommand(value: unknown): value is PlatformMenuCommand {
  return typeof value === "string"
    && (PLATFORM_MENU_COMMANDS as readonly string[]).includes(value);
}

export interface WindowControlsPort {
  close(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
}

export interface McpServerPort {
  setEnabled(enabled: boolean): Promise<void>;
  subscribeConnection(listener: (connected: boolean) => void): Promise<() => void>;
  subscribeRequests(listener: (chunk: string) => void): Promise<() => void>;
  writeResponse(line: string): Promise<void>;
}

export interface SaveFileDialogPort {
  choosePath(options: {
    readonly title: string;
    readonly suggestedName?: string;
    readonly extensions?: readonly string[];
  }): Promise<string | null>;
}

export interface MessageDialogPort {
  show(message: string, options?: {
    readonly title?: string;
    readonly kind?: "info" | "warning" | "error";
  }): Promise<void>;
}

export interface PlatformDialogs {
  readonly openDirectory: PlatformFeature<ProjectDirectoryPicker>;
  readonly saveFile: PlatformFeature<SaveFileDialogPort>;
  readonly message: PlatformFeature<MessageDialogPort>;
}

export interface ScadMillPlatform {
  readonly kind: "web" | "desktop";
  readonly aiFetch: AiFetchFactory;
  readonly engine: EngineService;
  readonly files: {
    readonly projectStorage?: ProjectStorage;
    readonly portabilityStorage?: ImportedProjectStorage;
    readonly workspaceDirectory?: WorkspaceDirectory;
    readonly directoryPicker: PlatformFeature<ProjectDirectoryPicker>;
    readonly revealInOs: PlatformFeature<true>;
    readonly trashInOs: PlatformFeature<true>;
    readonly fileAssociations: PlatformFeature<AssociatedFileOpenSource>;
    readonly slicerHandoff: PlatformFeature<true>;
  };
  readonly dialogs: PlatformDialogs;
  readonly menus: {
    readonly presentation: "web" | "native";
    readonly commands: PlatformFeature<PlatformCommandSource>;
  };
  readonly clipboard: ClipboardPort;
  readonly location: LocationPort;
  readonly persistence: {
    readonly layout: WorkspaceLayoutPersistence;
    readonly settings: SettingsPersistence;
    readonly secrets: SecretStore;
    readonly recovery: RecoveryPersistence;
    readonly recentProjects: RecentProjectsPersistence;
    readonly scratchAutosave: ScratchAutosavePersistence;
    readonly workspaceMetadata: WorkspaceMetadataPersistence;
    readonly welcome: WelcomePreferencePersistence;
    readonly renderCache: PlatformFeature<RenderDiskCacheStorage>;
    readonly renderCachePreferences: RenderDiskCachePreferencePersistence;
    readonly renderThumbnails: RenderThumbnailPersistence;
    readonly modelHistory: ModelHistoryPersistence;
  };
  readonly artifacts: ArtifactDestination;
  readonly enginePathConfiguration: PlatformFeature<EnginePathConfiguration>;
  readonly wasm: PlatformFeature<{
    readonly progress: EngineLoadProgressStore;
    clearProgress(): void;
  }>;
  readonly mcp: PlatformFeature<McpServerPort>;
  readonly windowControls: PlatformFeature<WindowControlsPort>;
  readonly engineVersionManager: PlatformFeature<true>;
  readonly forceNarrowLayout: boolean;
}

export function unavailable<T>(): PlatformFeature<T> {
  return Object.freeze({ available: false });
}

export function available<T>(service: T): PlatformFeature<T> {
  return Object.freeze({ available: true, service });
}
