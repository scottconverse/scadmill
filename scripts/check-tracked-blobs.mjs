#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { open, stat } from "node:fs/promises";
import { promisify } from "node:util";

import { evaluateTrackedBlobEntries } from "./lib/tracked-blob-policy.mjs";

const execFile = promisify(execFileCallback);
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1\n";

async function isLfsPointer(path, size) {
  if (size < LFS_POINTER_PREFIX.length || size > 1024) return false;
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(LFS_POINTER_PREFIX.length);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead).toString("utf8") === LFS_POINTER_PREFIX;
  } finally {
    await handle.close();
  }
}

const { stdout } = await execFile("git", ["ls-files", "--cached", "-z"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const paths = stdout.split("\0").filter(Boolean);
const entries = await Promise.all(paths.map(async (path) => {
  const metadata = await stat(path);
  return {
    path: path.replaceAll("\\", "/"),
    size: metadata.size,
    lfsPointer: metadata.isFile() && await isLfsPointer(path, metadata.size),
  };
}));
const violations = evaluateTrackedBlobEntries(entries);

if (violations.length > 0) {
  console.error("Tracked blob policy violations:");
  for (const violation of violations) {
    console.error(`- ${violation.path} [${violation.rule}] ${violation.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Tracked blob policy passed: ${entries.length} files checked, no Git LFS pointers, and every large file is within its explicit cap.`);
}
