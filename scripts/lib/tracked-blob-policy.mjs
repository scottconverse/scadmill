export const DEFAULT_TRACKED_BLOB_LIMIT = 1024 * 1024;

export const TRACKED_BLOB_EXCEPTIONS = Object.freeze({
  "src/vendor/kiri-moto/4.7.1/run/engine.js": 4_500_000,
  "src/vendor/kiri-moto/4.7.1/run/minion.js": 1_500_000,
  "src/vendor/kiri-moto/4.7.1/run/worker.js": 4_500_000,
  "website/public/og.png": 2_500_000,
});

export function evaluateTrackedBlobEntries(entries) {
  const violations = [];
  for (const entry of entries) {
    if (entry.lfsPointer) {
      violations.push({
        path: entry.path,
        rule: "git-lfs-pointer",
        message: "Git LFS pointers are not permitted; release and evidence artifacts stay outside Git history.",
      });
      continue;
    }

    const limit = TRACKED_BLOB_EXCEPTIONS[entry.path] ?? DEFAULT_TRACKED_BLOB_LIMIT;
    if (entry.size > limit) {
      violations.push({
        path: entry.path,
        rule: "tracked-blob-size",
        message: `Tracked file is ${entry.size} bytes; the explicit limit is ${limit} bytes.`,
      });
    }
  }
  return violations;
}
