export type Ac4ParityFormat = "stl-binary" | "svg";

export function canonicalAc4Bytes(
  format: Ac4ParityFormat,
  raw: Uint8Array,
): Uint8Array {
  if (format !== "svg") return raw.slice();
  const canonical: number[] = [];
  for (let index = 0; index < raw.byteLength; index += 1) {
    if (raw[index] === 0x0d && raw[index + 1] === 0x0a) continue;
    canonical.push(raw[index]);
  }
  return Uint8Array.from(canonical);
}
