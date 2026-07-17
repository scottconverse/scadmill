import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = process.argv[2] ? resolve(process.argv[2]) : null;
if (!sourceRoot) throw new Error("Usage: node scripts/stage-openscad-wasm-artifact.mjs <artifact-root>");

const destinationRoot = resolve("public", "openscad-engine", "2026.06.12");
const artifacts = [
  {
    source: "openscad/build-web/openscad.js",
    destination: "openscad.js",
    bytes: 100_027,
    sha256: "e458673d46d506d77b780c526d6e5492250f353d582057c6f912724a9586d86e",
  },
  {
    source: "openscad/build-web/openscad.wasm",
    destination: "openscad.wasm",
    bytes: 10_760_714,
    sha256: "f908aafa32febe9a3a20f76aca6b8101051bf2fc7655f094f18c6d99b52683ea",
  },
  {
    source: "openscad-wasm-manifest.json",
    destination: "manifest.json",
    bytes: 599,
    sha256: "ab195992b8316002d07d7630ae33ce276eb86a06be320be9f1604ca81a8787c4",
  },
];

await mkdir(destinationRoot, { recursive: true });
for (const artifact of artifacts) {
  const source = resolve(sourceRoot, artifact.source);
  const bytes = await readFile(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== artifact.bytes || hash !== artifact.sha256) {
    throw new Error(
      `Artifact verification failed for ${artifact.source}: ${bytes.byteLength} bytes, ${hash}.`,
    );
  }
  await copyFile(source, resolve(destinationRoot, artifact.destination));
  console.log(`Staged ${artifact.destination}: ${bytes.byteLength} bytes, ${hash}.`);
}
