export interface InstalledEngineVersion {
  readonly version: string;
  readonly executablePath: string;
  readonly sha256: string;
  readonly source: "managed" | "configured" | "discovered" | "bundled";
}

export interface OfficialEngineRelease {
  readonly id: string;
  readonly version: string;
  readonly platform: string;
  readonly archiveSha256: string;
}

export interface EngineVersionManagerPort {
  listInstalled(): Promise<readonly InstalledEngineVersion[]>;
  listOfficial(): Promise<readonly OfficialEngineRelease[]>;
  installOfficial(releaseId: string): Promise<InstalledEngineVersion>;
}
