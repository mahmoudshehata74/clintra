import { defineConfig } from "@playwright/test";
import base, { COMPARE_SPEC } from "./playwright.config";
import { browserArtifacts } from "./e2e/browserArtifacts";

const artifacts = browserArtifacts("compare");

/**
 * The side-by-side comparison of the app against the prototype
 * (e2e/compare.spec.ts): the same projects, server and settings as the
 * interaction run, but only that file. Output lands in e2e/compare/
 * (gitignored); open index.html in the run folder printed at the end.
 */
export default defineConfig({
  ...base,
  outputDir: artifacts.outputDir,
  reporter: [["list"], ["./e2e/retrySummaryReporter.ts"], artifacts.reporter],
  testMatch: COMPARE_SPEC,
  testIgnore: [],
  projects: base.projects?.map((project) => ({ ...project, testIgnore: [] })),
});
