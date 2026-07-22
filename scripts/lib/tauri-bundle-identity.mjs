import { createHash } from "node:crypto";

const BUILT_TOKEN = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK", "ascii");
const NSIS_TOKEN = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS", "ascii");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function tokenOffsets(bytes, token) {
  const offsets = [];
  let cursor = 0;
  while (cursor <= bytes.length - token.length) {
    const offset = bytes.indexOf(token, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    cursor = offset + 1;
  }
  return offsets;
}

export function verifyTauriBundleIdentity(builtBytes, packagedBytes) {
  const builtOffsets = tokenOffsets(builtBytes, BUILT_TOKEN);
  if (builtOffsets.length !== 1) {
    throw new Error(
      `The built application must contain exactly one unbundled token; found ${builtOffsets.length}.`,
    );
  }

  const packagedOffsets = tokenOffsets(packagedBytes, NSIS_TOKEN);
  if (packagedOffsets.length !== 1) {
    throw new Error(
      `The packaged application must contain exactly one NSIS token; found ${packagedOffsets.length}.`,
    );
  }

  if (builtOffsets[0] !== packagedOffsets[0]) {
    throw new Error("The documented Tauri bundle-type token moved between build and package.");
  }

  const normalizedPackagedBytes = Buffer.from(packagedBytes);
  BUILT_TOKEN.copy(normalizedPackagedBytes, packagedOffsets[0]);
  const builtSha256 = sha256(builtBytes);
  const packagedSha256 = sha256(packagedBytes);
  const normalizedPackagedSha256 = sha256(normalizedPackagedBytes);
  const normalizedMatch = builtBytes.equals(normalizedPackagedBytes);

  if (!normalizedMatch) {
    throw new Error(
      "The packaged application differs outside the documented Tauri bundle-type token.",
    );
  }

  return {
    builtSha256,
    normalizedMatch,
    normalizedPackagedSha256,
    packagedSha256,
    patch: {
      from: BUILT_TOKEN.toString("ascii"),
      offset: builtOffsets[0],
      to: NSIS_TOKEN.toString("ascii"),
    },
  };
}
