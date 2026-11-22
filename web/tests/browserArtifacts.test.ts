import { afterEach, expect, test, vi } from "vitest";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test/reporter";
import { allocateArtifactRun, browserArtifacts, shotDirectory } from "../e2e/browserArtifacts";
import BrowserArtifactReporter from "../e2e/browserArtifactReporter";

const registry = fileURLToPath(new URL("../../local/browser-artifact-checks/", import.meta.url));
const now = new Date("2026-11-22T08:04:05Z");

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test("runs in the same second never overwrite a previous run's open screenshot", () => {
  const earlier = allocateArtifactRun(registry, now);
  const later = allocateArtifactRun(registry, now);
  expect(earlier).not.toBe(later);
  expect(basename(earlier)).toMatch(/^20261122-100405-/);
  const base = join(earlier, "review-shots");
  vi.stubEnv("CLINTRA_BROWSER_ARTIFACT_RUN", earlier);
  const oldFile = join(shotDirectory(base), "review.png");
  writeFileSync(oldFile, "previous image", { flag: "wx" });
  const handle = openSync(oldFile, "r");
  try {
    vi.stubEnv("CLINTRA_BROWSER_ARTIFACT_RUN", later);
    const newFile = join(shotDirectory(base), "review.png");
    writeFileSync(newFile, "new image", { flag: "wx" });
    expect(newFile).not.toBe(oldFile);
    expect(readFileSync(oldFile, "utf8")).toBe("previous image");
    expect(readFileSync(newFile, "utf8")).toBe("new image");
  } finally {
    closeSync(handle);
  }
});

test("workers share the inherited run and its folders are printed at the end", () => {
  const runRoot = allocateArtifactRun(registry, now);
  vi.stubEnv("CLINTRA_BROWSER_ARTIFACT_RUN", runRoot);
  const first = browserArtifacts("web");
  const second = browserArtifacts("web");
  expect(first.outputDir).toBe(second.outputDir);
  expect(first.outputDir).toBe(join(runRoot, "test-results"));
  const folder = shotDirectory(join(runRoot, "shots"));
  expect(shotDirectory(join(runRoot, "shots"))).toBe(folder);
  expect(basename(folder)).toBe(basename(runRoot));
  mkdirSync(resolve(first.outputDir), { recursive: true });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const reporter = new BrowserArtifactReporter({ runRoot, suite: "web" });
  reporter.onBegin({ projects: [{ outputDir: first.outputDir }] } as FullConfig);
  reporter.onEnd();
  expect(log.mock.calls.map(call => call[0])).toEqual([
    `Browser screenshot run (web): ${basename(runRoot)}`,
    `Screenshot folder (web): ${folder}`,
    `Browser artifacts (web): ${first.outputDir}`,
  ]);
});
