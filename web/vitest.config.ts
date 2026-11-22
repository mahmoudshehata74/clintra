import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/browserArtifacts.test.ts"],
    setupFiles: ["src/test/setupIndexedDb.ts"],
  },
});
