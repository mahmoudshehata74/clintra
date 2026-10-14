import { defineConfig } from "@playwright/test";
import base, { COMPARE_SPEC } from "./playwright.config";

/**
 * The side-by-side comparison of the app against the prototype
 * (e2e/compare.spec.ts): the same projects, server and settings as the
 * interaction run, but only that file. Output lands in e2e/compare/
 * (gitignored); open e2e/compare/index.html.
 */
export default defineConfig({
  ...base,
  testMatch: COMPARE_SPEC,
  testIgnore: [],
  projects: base.projects?.map((project) => ({ ...project, testIgnore: [] })),
});
