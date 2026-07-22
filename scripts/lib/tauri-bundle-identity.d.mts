export interface TauriBundleIdentityResult {
  builtSha256: string;
  packagedSha256: string;
  normalizedPackagedSha256: string;
  normalizedMatch: boolean;
  patch: {
    from: string;
    offset: number;
    to: string;
  };
}

export function verifyTauriBundleIdentity(
  builtBytes: Uint8Array,
  packagedBytes: Uint8Array,
): TauriBundleIdentityResult;
