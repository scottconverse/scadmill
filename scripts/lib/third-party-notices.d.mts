export interface NoticePackage {
  readonly ecosystem: "npm" | "cargo";
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly authors: readonly string[];
  readonly repository: string | null;
  readonly licenseTexts: readonly { readonly name: string; readonly text: string }[];
}

export interface CargoMetadata {
  readonly packages?: readonly { readonly id: string; readonly name: string; readonly version: string }[];
}

export function isNoticeFileName(name: string): boolean;
export function resolveContainedPath(base: string, candidate: string): string;
export function readContainedFile(directory: string, candidate: string): Promise<Buffer>;
export function windowsCargoTreeArguments(manifestPath: string): string[];
export function resolveActivatedCargoPackageIds(metadata: CargoMetadata, treeOutput: string): Set<string>;
export function renderThirdPartyNotices(input: {
  readonly npmPackages: readonly NoticePackage[];
  readonly rustPackages: readonly NoticePackage[];
  readonly webView2: {
    readonly distribution: string;
    readonly termsUrl: string;
    readonly distributionUrl: string;
  };
  readonly nsis: {
    readonly distribution: string;
    readonly compression: string;
    readonly sourceUrl: string;
    readonly licenseText: string;
  };
  readonly msvc: {
    readonly distribution: string;
    readonly termsUrl: string;
  };
}): string;
