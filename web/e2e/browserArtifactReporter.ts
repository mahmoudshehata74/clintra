import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { FullConfig, Reporter } from "@playwright/test/reporter";

export default class BrowserArtifactReporter implements Reporter {
  private readonly options: { runRoot: string; suite: string };
  private outputDirectories: string[] = [];

  constructor(options: { runRoot: string; suite: string }) {
    this.options = options;
  }

  onBegin(config: FullConfig): void {
    this.outputDirectories = [...new Set(config.projects.map(project => project.outputDir))];
  }

  onEnd(): void {
    const { runRoot, suite } = this.options;
    const manifest = join(runRoot, "shot-folders.jsonl");
    const folders = existsSync(manifest)
      ? [...new Set(readFileSync(manifest, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string))].sort()
      : [];
    console.log(`Browser screenshot run (${suite}): ${basename(runRoot)}`);
    for (const folder of folders) console.log(`Screenshot folder (${suite}): ${folder}`);
    for (const folder of this.outputDirectories) console.log(`Browser artifacts (${suite}): ${folder}`);
  }
}
