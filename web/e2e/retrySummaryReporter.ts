import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { appendFileSync } from "node:fs";

/**
 * CI runs with retries: 1 and failOnFlakyTests (playwright.config.ts), so a
 * test that only passes on its second attempt already fails the run. This
 * reporter names those tests where they are easy to find: nothing at all on
 * an ordinary all-first-try-green run (the common case, left untouched), a
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
        "These tests failed once and passed on the retry — the run is failed as flaky.",
        "",
        ...this.retried.map((title) => `- ${title}`),
        "",
      ].join("\n");
      appendFileSync(summaryPath, body);
    }
  }
}
