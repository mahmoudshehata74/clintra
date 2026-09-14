import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { appendFileSync } from "node:fs";

/**
 * CI runs with retries: 1 (playwright.config.ts) — a real regression that
 * only fails once still exits the job green on the second attempt. That
 * silently defeats the whole point of watching CI's colour, so this adds
 * exactly one visible marker when it happens: nothing at all on an
 * ordinary all-first-try-green run (the common case, left untouched), a
 * GitHub Actions warning annotation plus a job-summary line when a test
 * needed a retry to pass.
 */
export default class RetrySummaryReporter implements Reporter {
  private readonly retried: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.retry > 0 && result.status === "passed") {
      this.retried.push(test.titlePath().slice(1).join(" › "));
    }
  }

  onEnd(): void {
    if (this.retried.length === 0) {
      return;
    }

    console.log(`::warning::${this.retried.length} test(s) passed only after a retry:`);
    for (const title of this.retried) {
      console.log(`::warning::  ${title}`);
    }

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      const body = [
        "## ⚠️ Tests passed only after a retry",
        "A green run below still needed a second attempt — treat this as a flake report, not a clean pass.",
        "",
        ...this.retried.map((title) => `- ${title}`),
        "",
      ].join("\n");
      appendFileSync(summaryPath, body);
    }
  }
}
