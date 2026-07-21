import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ViewerPerformanceProfile } from "./fixtures/m2-viewer-performance";
import {
  assessViewerPerformance,
  collectViewerPerformanceSourceIdentity,
  invalidateViewerPerformanceArtifact,
  publishViewerPerformanceArtifact,
  VIEWER_PERFORMANCE_HARNESS_PATHS,
  type ViewerPerformanceEvidenceCandidate,
} from "./viewer-performance-evidence";

const temporaryRoots: string[] = [];
const SAMPLE_STARTED_AT = "2026-07-15T12:00:00.000Z";
const SOURCE_TEST_TIMEOUT_MS = 120_000;

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function passingProfile(renderer = "ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11)"):
ViewerPerformanceProfile {
  const cameraDelta = Math.hypot(400, 400, 300);
  return {
    averageFps: 60,
    cameraDelta,
    cameraEnd: {
      position: [1_400, 900, 1_200],
      projection: "perspective",
      target: [1_000, 500, 0],
      up: [0, 0, 1],
      zoom: 1,
    },
    cameraStart: {
      position: [1_800, 1_300, 1_500],
      projection: "perspective",
      target: [1_000, 500, 0],
      up: [0, 0, 1],
      zoom: 1,
    },
    degradation: { edges: true, shadow: true },
    durationMs: 3_000,
    frames: 180,
    hardwareConcurrency: 16,
    longTaskCount: 0,
    longestFrameMs: 17,
    longestLongTaskMs: 0,
    longestRenderMs: 1,
    p95FrameMs: 17,
    p95RenderMs: 1,
    renderedFps: 60,
    renderedFrames: 180,
    renderer,
    triangleCount: 2_000_000,
    trustedOrbitPointerMoves: 180,
    userAgent: "test",
    vendor: "test",
  };
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

async function createSourceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-source-"));
  temporaryRoots.push(root);
  git(root, "init");
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "user.email", "viewer-evidence@example.invalid");
  git(root, "config", "user.name", "Viewer Evidence Test");
  git(root, "config", "commit.gpgsign", "false");
  for (const path of VIEWER_PERFORMANCE_HARNESS_PATHS) {
    const absolutePath = resolve(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `fixture for ${path}\n`, "utf8");
  }
  await writeFile(resolve(root, "000-source-marker.txt"), "tracked source marker\n", "utf8");
  git(root, "add", "--all");
  git(root, "commit", "-m", "test fixture");
  return root;
}

describe("viewer performance evidence", () => {
  it("invalidates stale evidence before the owner workload preflight can reject", async () => {
    const runner = await readFile(
      resolve(process.cwd(), "tests/performance/m2-viewer-performance.perf.ts"),
      "utf8",
    );
    const invalidation = runner.indexOf(
      "const artifactPath = await invalidateViewerPerformanceArtifact",
    );
    const ownerWorkloadGuard = runner.indexOf("TRIANGLE_COUNT !== 2_000_000");

    expect(invalidation).toBeGreaterThanOrEqual(0);
    expect(ownerWorkloadGuard).toBeGreaterThanOrEqual(0);
    expect(invalidation).toBeLessThan(ownerWorkloadGuard);
    const pageErrorWindowClose = runner.indexOf('page.off("pageerror"');
    const consoleWindowClose = runner.indexOf('page.off("console"');
    const publication = runner.indexOf("publishViewerPerformanceArtifact(artifactPath");
    expect(pageErrorWindowClose).toBeGreaterThanOrEqual(0);
    expect(consoleWindowClose).toBeGreaterThanOrEqual(0);
    expect(pageErrorWindowClose).toBeLessThan(publication);
    expect(consoleWindowClose).toBeLessThan(publication);
  });

  it("routes profiling through invalidation before Playwright lifecycle work", async () => {
    const packageDocument = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8"));
    expect(packageDocument.scripts["profile:viewer"]).toBe(
      "node scripts/run-viewer-performance-profile.mjs",
    );
    const wrapper = await readFile(
      resolve(process.cwd(), "scripts/run-viewer-performance-profile.mjs"),
      "utf8",
    );
    expect(wrapper.indexOf("invalidateViewerPerformanceProfile")).toBeLessThan(
      wrapper.indexOf("runPlaywright"),
    );
  });

  it("removes stale evidence and cannot publish a rejected owner-baseline profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const stalePath = join(root, "viewer-performance-profile.json");
    await writeFile(stalePath, '{"status":"pass","stale":true}\n', "utf8");

    const artifactPath = await invalidateViewerPerformanceArtifact(root);
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });

    const profile = passingProfile("ANGLE (NVIDIA, GeForce RTX 4090 Direct3D11)");
    const acceptance = assessViewerPerformance({
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      pageErrors: [],
      profile,
      requiredRenderer: /AMD Radeon 780M/iu,
      requiredRendererDescription: "AMD Radeon 780M",
    });

    expect(acceptance.pass).toBe(false);
    expect(acceptance.errors).toContain("renderer does not match required AMD Radeon 780M baseline");
    await expect(publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors: [],
      profile,
      startedAt: SAMPLE_STARTED_AT,
    })).rejects.toThrow("Refusing to publish rejected viewer performance evidence");
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recomputes acceptance and rejects non-finite, fractional, short, and slow profiles", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const artifactPath = await invalidateViewerPerformanceArtifact(root);
    const invalidProfiles: ViewerPerformanceProfile[] = [
      { ...passingProfile(), renderedFps: Number.NaN },
      { ...passingProfile(), durationMs: Number.NaN },
      { ...passingProfile(), frames: Number.NaN },
      { ...passingProfile(), renderedFrames: Number.NaN },
      { ...passingProfile(), trustedOrbitPointerMoves: Number.NaN },
      { ...passingProfile(), frames: 1.5 },
      { ...passingProfile(), renderedFrames: 1.5 },
      { ...passingProfile(), trustedOrbitPointerMoves: 30.5 },
      { ...passingProfile(), averageFps: 1, renderedFps: 1 },
      { ...passingProfile(), durationMs: 2_999 },
    ];

    for (const profile of invalidProfiles) {
      await expect(publishViewerPerformanceArtifact(artifactPath, {
        acceptance: { errors: [], pass: true },
        consoleErrors: [],
        expectedTriangleCount: 2_000_000,
        hardwareQualification: "owner-baseline-amd-radeon-780m",
        pageErrors: [],
        profile,
        startedAt: SAMPLE_STARTED_AT,
      } as ViewerPerformanceEvidenceCandidate & {
        acceptance: { errors: readonly string[]; pass: boolean };
      })).rejects.toThrow("Refusing to publish rejected viewer performance evidence");
      await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("binds the owner hardware label to exactly two million triangles", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const artifactPath = await invalidateViewerPerformanceArtifact(root);
    const profile = { ...passingProfile(), triangleCount: 1 };

    await expect(publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors: [],
      expectedTriangleCount: 1,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors: [],
      profile,
      startedAt: SAMPLE_STARTED_AT,
    })).rejects.toThrow("owner baseline requires expected triangle count 2000000");
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects contradictory reported FPS and camera-delta metrics", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const artifactPath = await invalidateViewerPerformanceArtifact(root);
    const cases: { readonly error: string; readonly profile: ViewerPerformanceProfile }[] = [
      {
        error: "average FPS does not match frame count and duration",
        profile: { ...passingProfile(), averageFps: 60, frames: 1 },
      },
      {
        error: "rendered FPS does not match rendered frame count and duration",
        profile: { ...passingProfile(), renderedFps: 60, renderedFrames: 1 },
      },
      {
        error: "trusted orbit did not produce a camera delta",
        profile: {
          ...passingProfile(),
          cameraEnd: passingProfile().cameraStart,
          cameraDelta: 100,
        },
      },
      {
        error: "camera delta does not match the recorded camera endpoints",
        profile: { ...passingProfile(), cameraDelta: 1 },
      },
    ];

    for (const { error, profile } of cases) {
      const assessment = assessViewerPerformance({
        consoleErrors: [],
        expectedTriangleCount: 2_000_000,
        pageErrors: [],
        profile,
      });
      expect(assessment.pass).toBe(false);
      expect(assessment.errors).toContain(error);
      await expect(publishViewerPerformanceArtifact(artifactPath, {
        consoleErrors: [],
        expectedTriangleCount: 2_000_000,
        hardwareQualification: "unqualified-current-host",
        pageErrors: [],
        profile,
        startedAt: SAMPLE_STARTED_AT,
      })).rejects.toThrow(error);
      await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("returns a rejection instead of throwing for malformed camera observations", () => {
    const profile = { ...passingProfile(), cameraStart: undefined } as unknown as
      ViewerPerformanceProfile;

    expect(() => assessViewerPerformance({
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      pageErrors: [],
      profile,
    })).not.toThrow();
    expect(assessViewerPerformance({
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      pageErrors: [],
      profile,
    })).toMatchObject({ pass: false });
  });

  it("publishes a source-bound passing envelope only after validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const artifactPath = await invalidateViewerPerformanceArtifact(root);
    const sourceRoot = await createSourceRoot();
    await writeFile(
      resolve(sourceRoot, VIEWER_PERFORMANCE_HARNESS_PATHS[0]),
      "fully staged candidate harness\n",
      "utf8",
    );
    git(sourceRoot, "add", "--all");
    const sourceIdentity = await collectViewerPerformanceSourceIdentity(sourceRoot);
    expect(sourceIdentity.sourceState).toBe("fully-staged-candidate");
    const profile = passingProfile();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const acceptance = assessViewerPerformance({
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      pageErrors: [],
      profile,
      requiredRenderer: /AMD Radeon 780M/iu,
      requiredRendererDescription: "AMD Radeon 780M",
    });
    expect(acceptance).toEqual({ errors: [], pass: true });

    const publication = publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors,
      expectedTriangleCount: 2_000_000,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors,
      profile,
      sourceIdentity,
      startedAt: SAMPLE_STARTED_AT,
    }, { sourceRoot });
    consoleErrors.push("late console error outside the frozen observation window");
    pageErrors.push("late page error outside the frozen observation window");
    Object.assign(profile, {
      degradation: { edges: false, shadow: false },
      renderedFps: 1,
      renderer: "SwiftShader",
    });
    await publication;

    const evidence = JSON.parse(await readFile(artifactPath, "utf8"));
    expect(evidence).toMatchObject({
      acceptance: { errors: [], pass: true },
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      observations: { consoleErrors: [], pageErrors: [] },
      profile: {
        degradation: { edges: true, shadow: true },
        renderedFps: 60,
        renderer: "ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11)",
        trustedOrbitPointerMoves: 180,
      },
      schemaVersion: 1,
      source: {
        harnessFiles: VIEWER_PERFORMANCE_HARNESS_PATHS.map((path) => ({ path })),
        harnessSha256: expect.stringMatching(/^[A-F0-9]{64}$/u),
        sourceCommit: sourceIdentity.sourceCommit,
        sourceTree: sourceIdentity.sourceTree,
      },
      startedAt: SAMPLE_STARTED_AT,
      status: "pass",
      workload: {
        expectedTriangleCount: 2_000_000,
        interaction: "trusted-pointer-orbit",
        minimumAverageFps: 30,
        minimumRenderedFps: 30,
        minimumSampleDurationMs: 3_000,
      },
    });
    expect(Date.parse(evidence.completedAt)).toBeGreaterThanOrEqual(Date.parse(SAMPLE_STARTED_AT));
    for (const file of sourceIdentity.harnessFiles) {
      expect(file.sha256).toBe(
        createHash("sha256")
          .update(await readFile(resolve(sourceRoot, file.path)))
          .digest("hex")
          .toUpperCase(),
      );
    }
    git(sourceRoot, "commit", "-m", "candidate");
    expect(git(sourceRoot, "rev-parse", "HEAD^{tree}")).toBe(sourceIdentity.sourceTree);
  }, SOURCE_TEST_TIMEOUT_MS);

  it("requires an owner source identity captured before sampling", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(root);
    const artifactPath = await invalidateViewerPerformanceArtifact(root);

    await expect(publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors: [],
      profile: passingProfile(),
      startedAt: SAMPLE_STARTED_AT,
    })).rejects.toThrow("owner baseline requires a source identity captured before sampling");
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses publication when source changes after the sample starts", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(artifactRoot);
    const artifactPath = await invalidateViewerPerformanceArtifact(artifactRoot);
    const sourceRoot = await createSourceRoot();
    const sourceIdentity = await collectViewerPerformanceSourceIdentity(sourceRoot);
    await writeFile(resolve(sourceRoot, "unexpected-after-sample.txt"), "unexpected\n", "utf8");

    await expect(publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors: [],
      profile: passingProfile(),
      sourceIdentity,
      startedAt: SAMPLE_STARTED_AT,
    }, { sourceRoot })).rejects.toThrow(
      "Viewer performance evidence requires no unstaged or untracked source files.",
    );
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, SOURCE_TEST_TIMEOUT_MS);

  it("rejects a lexically first tracked but unstaged source divergence", async () => {
    const sourceRoot = await createSourceRoot();
    await writeFile(
      resolve(sourceRoot, VIEWER_PERFORMANCE_HARNESS_PATHS[0]),
      "fully staged candidate harness\n",
      "utf8",
    );
    git(sourceRoot, "add", "--all");
    await writeFile(resolve(sourceRoot, "000-source-marker.txt"), "unstaged divergence\n", "utf8");

    await expect(collectViewerPerformanceSourceIdentity(sourceRoot)).rejects.toThrow(
      "Viewer performance evidence requires no unstaged or untracked source files.",
    );
  }, SOURCE_TEST_TIMEOUT_MS);

  it("refuses publication when staged source changes after the sample starts", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
    temporaryRoots.push(artifactRoot);
    const artifactPath = await invalidateViewerPerformanceArtifact(artifactRoot);
    const sourceRoot = await createSourceRoot();
    const sourceIdentity = await collectViewerPerformanceSourceIdentity(sourceRoot);
    await writeFile(
      resolve(sourceRoot, VIEWER_PERFORMANCE_HARNESS_PATHS[0]),
      "staged change after sampling began\n",
      "utf8",
    );
    git(sourceRoot, "add", "--all");

    await expect(publishViewerPerformanceArtifact(artifactPath, {
      consoleErrors: [],
      expectedTriangleCount: 2_000_000,
      hardwareQualification: "owner-baseline-amd-radeon-780m",
      pageErrors: [],
      profile: passingProfile(),
      sourceIdentity,
      startedAt: SAMPLE_STARTED_AT,
    }, { sourceRoot })).rejects.toThrow("source identity changed during the performance sample");
    await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, SOURCE_TEST_TIMEOUT_MS);

  it("rejects a harness file that is present on disk but absent from the source tree", async () => {
    const sourceRoot = await createSourceRoot();
    const ignoredHarness = VIEWER_PERFORMANCE_HARNESS_PATHS[0];
    git(sourceRoot, "rm", "--cached", ignoredHarness);
    await writeFile(resolve(sourceRoot, ".gitignore"), `${ignoredHarness}\n`, "utf8");
    git(sourceRoot, "add", ".gitignore");
    git(sourceRoot, "commit", "-m", "ignore one harness file");

    await expect(collectViewerPerformanceSourceIdentity(sourceRoot)).rejects.toThrow(
      "Profiler harness file is not bound to the candidate source tree",
    );
  }, SOURCE_TEST_TIMEOUT_MS);

  it("requires a canonical, non-future sample timestamp", async () => {
    for (const startedAt of ["July 15, 2026", "9999-01-01T00:00:00.000Z"]) {
      const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-profile-"));
      temporaryRoots.push(root);
      const artifactPath = await invalidateViewerPerformanceArtifact(root);

      await expect(publishViewerPerformanceArtifact(artifactPath, {
        consoleErrors: [],
        expectedTriangleCount: 2_000_000,
        hardwareQualification: "unqualified-current-host",
        pageErrors: [],
        profile: passingProfile(),
        startedAt,
      })).rejects.toThrow("performance sample start time must be canonical ISO-8601 and not future");
      await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});
