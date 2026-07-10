export interface LicensedPackage {
  name: string;
  version: string;
  license: string | null;
  source?: string | null;
}

export function isAllowedLicenseExpression(expression: string | null | undefined): boolean;
export function findDisallowedPackages(packages: LicensedPackage[]): LicensedPackage[];
