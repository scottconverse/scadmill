export interface MobileWebNavigator {
  readonly userAgent?: string;
  readonly userAgentData?: { readonly mobile?: boolean };
  readonly platform?: string;
  readonly maxTouchPoints?: number;
}

export function isMobileWebClient(
  client: MobileWebNavigator = globalThis.navigator,
): boolean {
  const mobileHint = client.userAgentData?.mobile;
  if (typeof mobileHint === "boolean") return mobileHint;
  if (client.platform === "MacIntel" && (client.maxTouchPoints ?? 0) > 1) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(client.userAgent ?? "");
}
