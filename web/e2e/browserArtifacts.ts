import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReporterDescription } from "@playwright/test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const runEnvironment = "CLINTRA_BROWSER_ARTIFACT_RUN";

/** Atomic allocation also separates simultaneous runs within the same second. */
export function allocateArtifactRun(registry = resolve(webRoot, "../local/browser-runs"), now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  const stamp = `${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}${part("second")}`;
  mkdirSync(registry, { recursive: true });
  return mkdtempSync(join(registry, `${stamp}-`));
}

/** The runner allocates once; its worker processes inherit the same run directory. */
export function browserArtifacts(suite: string): { outputDir: string; reporter: ReporterDescription } {
  const runRoot = process.env[runEnvironment] ?? allocateArtifactRun();
  process.env[runEnvironment] = runRoot;
  return {
    outputDir: join(runRoot, "test-results"),
    reporter: [fileURLToPath(new URL("./browserArtifactReporter.ts", import.meta.url)), { runRoot, suite }],
  };
}

/** A fresh child of each existing ignored shot folder; older runs are untouched. */
export function shotDirectory(base: string): string {
  const runRoot = process.env[runEnvironment];
  if (!runRoot) throw new Error("Initialize browser artifacts in the Playwright configuration first.");
  const directory = join(resolve(webRoot, base), basename(runRoot));
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(runRoot, "shot-folders.jsonl"), JSON.stringify(directory) + "\n");
  return directory;
}
