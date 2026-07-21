import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ViewerPerformanceProfile } from "./fixtures/m2-viewer-performance";

const PROFILE_FILENAME = "viewer-performance-profile.json";
const OWNER_BASELINE_QUALIFICATION = "owner-baseline-amd-radeon-780m";
const OWNER_BASELINE_RENDERER = /AMD Radeon 780M/iu;
const OWNER_BASELINE_TRIANGLE_COUNT = 2_000_000;
export const VIEWER_PERFORMANCE_HARNESS_PATHS = [
  "package.json",
  "scripts/run-viewer-performance-profile.mjs",
  "tests/performance/fixtures/m2-viewer-performance.tsx",
  "tests/performance/m2-viewer-performance.perf.ts",
  "tests/performance/viewer-performance-evidence.ts",
  "tests/performance/viewer-performance.playwright.config.ts",
] as const;

export interface ViewerPerformanceSourceIdentity {
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly sourceBranch: string;
  readonly sourceState: "clean-head" | "fully-staged-candidate";
  readonly harnessSha256: string;
  readonly harnessFiles: readonly {
    readonly gitBlob: string;
    readonly path: string;
    readonly sha256: string;
  }[];
}

export interface ViewerPerformanceAcceptance {
  readonly pass: boolean;
  readonly errors: readonly string[];
}

export interface ViewerPerformanceAssessmentInput {
  readonly consoleErrors: readonly string[];
  readonly expectedTriangleCount: number;
  readonly pageErrors: readonly string[];
  readonly profile: ViewerPerformanceProfile;
  readonly requiredRenderer?: RegExp;
  readonly requiredRendererDescription?: string;
}

export interface ViewerPerformanceEvidenceCandidate {
  readonly consoleErrors: readonly string[];
  readonly expectedTriangleCount: number;
  readonly hardwareQualification: string;
  readonly pageErrors: readonly string[];
  readonly profile: ViewerPerformanceProfile;
  readonly sourceIdentity?: ViewerPerformanceSourceIdentity;
  readonly startedAt: string;
}

function gitOutput(sourceRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, {
    cwd: sourceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function gitText(sourceRoot: string, args: readonly string[]): string {
  return gitOutput(sourceRoot, args).trim();
}

export async function collectViewerPerformanceSourceIdentity(
  sourceRoot: string,
): Promise<ViewerPerformanceSourceIdentity> {
  const status = gitOutput(
    sourceRoot,
    ["status", "--porcelain=v1", "--untracked-files=all"],
  ).trimEnd();
  const statusLines = status.length === 0 ? [] : status.split(/\r?\n/u);
  if (statusLines.some((line) => line.startsWith("??") || line[1] !== " ")) {
    throw new Error(
      "Viewer performance evidence requires no unstaged or untracked source files.",
    );
  }
  const sourceTree = gitText(sourceRoot, ["write-tree"]);
  const harnessFiles = await Promise.all(VIEWER_PERFORMANCE_HARNESS_PATHS.map(async (path) => {
    let gitBlob: string;
    try {
      gitBlob = gitText(sourceRoot, ["rev-parse", `${sourceTree}:${path}`]);
    } catch {
      throw new Error(
        `Profiler harness file is not bound to the candidate source tree: ${path}`,
      );
    }
    const workingBlob = gitText(sourceRoot, ["hash-object", "--path", path, path]);
    if (workingBlob !== gitBlob) {
      throw new Error(
        `Profiler harness working file differs from the candidate source tree: ${path}`,
      );
    }
    const bytes = await readFile(resolve(sourceRoot, path));
    return {
      gitBlob,
      path,
      sha256: createHash("sha256").update(bytes).digest("hex").toUpperCase(),
    };
  }));
  const aggregate = createHash("sha256");
  for (const file of harnessFiles) {
    aggregate.update(file.path);
    aggregate.update("\0");
    aggregate.update(file.sha256);
    aggregate.update("\0");
  }
  return {
    sourceCommit: gitText(sourceRoot, ["rev-parse", "HEAD"]),
    sourceTree,
    sourceBranch: gitText(sourceRoot, ["branch", "--show-current"]),
    sourceState: statusLines.length === 0 ? "clean-head" : "fully-staged-candidate",
    harnessSha256: aggregate.digest("hex").toUpperCase(),
    harnessFiles,
  };
}

function approximatelyEqual(reported: number, derived: number): boolean {
  const tolerance = Math.max(1e-9, Math.abs(derived) * 1e-9);
  return Number.isFinite(reported) && Number.isFinite(derived)
    && Math.abs(reported - derived) <= tolerance;
}

function derivedCameraDelta(profile: ViewerPerformanceProfile): number | null {
  const start = profile.cameraStart as unknown;
  const end = profile.cameraEnd as unknown;
  if (!start || typeof start !== "object" || !end || typeof end !== "object") return null;
  const startRecord = start as Record<string, unknown>;
  const endRecord = end as Record<string, unknown>;
  const vectors = [
    startRecord.position,
    startRecord.target,
    startRecord.up,
    endRecord.position,
    endRecord.target,
    endRecord.up,
  ];
  if (vectors.some((vector) => !Array.isArray(vector)
    || vector.length !== 3
    || vector.some((value) => !Number.isFinite(value)))) return null;
  if (!Number.isFinite(startRecord.zoom) || !Number.isFinite(endRecord.zoom)) return null;
  const [startPosition, startTarget, startUp, endPosition, endTarget, endUp] = vectors as
    [number[], number[], number[], number[], number[], number[]];
  return Math.hypot(
    ...startPosition.map((value, axis) => value - endPosition[axis]),
    ...startTarget.map((value, axis) => value - endTarget[axis]),
    ...startUp.map((value, axis) => value - endUp[axis]),
    Number(startRecord.zoom) - Number(endRecord.zoom),
  );
}

export function assessViewerPerformance({
  consoleErrors,
  expectedTriangleCount,
  pageErrors,
  profile,
  requiredRenderer,
  requiredRendererDescription = String(requiredRenderer),
}: ViewerPerformanceAssessmentInput): ViewerPerformanceAcceptance {
  const errors: string[] = [];
  if (!Number.isSafeInteger(expectedTriangleCount) || expectedTriangleCount <= 0) {
    errors.push("expected triangle count is not a positive safe integer");
  }
  const degraded = expectedTriangleCount > 500_000;
  if (profile.triangleCount !== expectedTriangleCount) {
    errors.push(`triangle count ${profile.triangleCount} does not equal ${expectedTriangleCount}`);
  }
  if (!profile.degradation
    || profile.degradation.edges !== degraded
    || profile.degradation.shadow !== degraded) {
    errors.push(`degradation does not match expected edges=${degraded}, shadow=${degraded}`);
  }
  if (/SwiftShader|llvmpipe|software/iu.test(profile.renderer)) {
    errors.push("renderer is software-backed");
  }
  if (requiredRenderer && !requiredRenderer.test(profile.renderer)) {
    errors.push(`renderer does not match required ${requiredRendererDescription} baseline`);
  }
  if (!Number.isFinite(profile.averageFps) || profile.averageFps <= 0) {
    errors.push("average FPS is not positive");
  }
  if (!Number.isInteger(profile.renderedFrames) || profile.renderedFrames <= 0) {
    errors.push("rendered frame count is not a positive integer");
  }
  if (!Number.isFinite(profile.renderedFps) || profile.renderedFps <= 0) {
    errors.push("rendered FPS is not positive");
  }
  if (expectedTriangleCount === 2_000_000) {
    if (profile.averageFps < 30) errors.push("average FPS is below 30");
    if (profile.renderedFps < 30) errors.push("rendered FPS is below 30");
  }
  if (!Number.isInteger(profile.frames) || profile.frames <= 0) {
    errors.push("animation frame count is not a positive integer");
  }
  if (!Number.isFinite(profile.durationMs) || profile.durationMs < 3_000) {
    errors.push("timed sample is shorter than 3,000 ms or non-finite");
  }
  if (!Number.isInteger(profile.trustedOrbitPointerMoves)
    || profile.trustedOrbitPointerMoves < 30) {
    errors.push("fewer than 30 trusted orbit pointer moves occurred during the timed sample");
  }
  const durationSeconds = profile.durationMs / 1_000;
  const averageFps = profile.frames / durationSeconds;
  const renderedFps = profile.renderedFrames / durationSeconds;
  if (!approximatelyEqual(profile.averageFps, averageFps)) {
    errors.push("average FPS does not match frame count and duration");
  }
  if (!approximatelyEqual(profile.renderedFps, renderedFps)) {
    errors.push("rendered FPS does not match rendered frame count and duration");
  }
  const cameraDelta = derivedCameraDelta(profile);
  if (cameraDelta === null || cameraDelta <= 0) {
    errors.push("trusted orbit did not produce a camera delta");
  } else if (!approximatelyEqual(profile.cameraDelta, cameraDelta)) {
    errors.push("camera delta does not match the recorded camera endpoints");
  }
  errors.push(...pageErrors.map((error) => `page error: ${error}`));
  errors.push(...consoleErrors.map((error) => `console error: ${error}`));
  return { pass: errors.length === 0, errors };
}

export async function invalidateViewerPerformanceArtifact(artifactDirectory: string): Promise<string> {
  await mkdir(artifactDirectory, { recursive: true });
  const artifactPath = resolve(artifactDirectory, PROFILE_FILENAME);
  await rm(artifactPath, { force: true });
  return artifactPath;
}

export async function publishViewerPerformanceArtifact(
  artifactPath: string,
  {
    consoleErrors,
    expectedTriangleCount,
    hardwareQualification,
    pageErrors,
    profile,
    sourceIdentity,
    startedAt,
  }: ViewerPerformanceEvidenceCandidate,
  { sourceRoot = process.cwd() }: { readonly sourceRoot?: string } = {},
): Promise<void> {
  const completedAt = new Date().toISOString();
  const observedConsoleErrors = Object.freeze([...consoleErrors]);
  const observedPageErrors = Object.freeze([...pageErrors]);
  const observedProfile = structuredClone(profile);
  const observedSourceIdentity = sourceIdentity
    ? structuredClone(sourceIdentity)
    : undefined;
  const ownerBaseline = hardwareQualification === OWNER_BASELINE_QUALIFICATION;
  const assessed = assessViewerPerformance({
    consoleErrors: observedConsoleErrors,
    expectedTriangleCount: ownerBaseline ? OWNER_BASELINE_TRIANGLE_COUNT : expectedTriangleCount,
    pageErrors: observedPageErrors,
    profile: observedProfile,
    requiredRenderer: ownerBaseline ? OWNER_BASELINE_RENDERER : undefined,
    requiredRendererDescription: ownerBaseline ? "AMD Radeon 780M" : undefined,
  });
  const errors = [...assessed.errors];
  if (ownerBaseline && expectedTriangleCount !== OWNER_BASELINE_TRIANGLE_COUNT) {
    errors.unshift(`owner baseline requires expected triangle count ${OWNER_BASELINE_TRIANGLE_COUNT}`);
  }
  let verifiedSourceIdentity = observedSourceIdentity;
  if (ownerBaseline) {
    if (!observedSourceIdentity) {
      errors.push("owner baseline requires a source identity captured before sampling");
    } else {
      try {
        const currentSourceIdentity = await collectViewerPerformanceSourceIdentity(sourceRoot);
        if (JSON.stringify(currentSourceIdentity) !== JSON.stringify(observedSourceIdentity)) {
          errors.push("source identity changed during the performance sample");
        } else {
          verifiedSourceIdentity = currentSourceIdentity;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "source identity could not be verified");
      }
    }
  }
  const parsedStartedAt = typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
  const canonicalStartedAt = Number.isFinite(parsedStartedAt)
    && new Date(parsedStartedAt).toISOString() === startedAt;
  if (!canonicalStartedAt || parsedStartedAt > Date.parse(completedAt)) {
    errors.push("performance sample start time must be canonical ISO-8601 and not future");
  }
  const acceptance = { pass: errors.length === 0, errors };
  if (!acceptance.pass || acceptance.errors.length > 0) {
    throw new Error(
      `Refusing to publish rejected viewer performance evidence: ${acceptance.errors.join("; ")}`,
    );
  }
  const evidence = {
    schemaVersion: 1,
    acceptance: { pass: true, errors: [] },
    completedAt,
    hardwareQualification,
    observations: {
      consoleErrors: observedConsoleErrors,
      pageErrors: observedPageErrors,
    },
    profile: observedProfile,
    source: verifiedSourceIdentity ?? null,
    startedAt,
    status: "pass",
    workload: {
      expectedTriangleCount: ownerBaseline
        ? OWNER_BASELINE_TRIANGLE_COUNT
        : expectedTriangleCount,
      interaction: "trusted-pointer-orbit",
      minimumAverageFps: expectedTriangleCount === OWNER_BASELINE_TRIANGLE_COUNT ? 30 : null,
      minimumRenderedFps: expectedTriangleCount === OWNER_BASELINE_TRIANGLE_COUNT ? 30 : null,
      minimumSampleDurationMs: 3_000,
    },
  } as const;
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
