import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBaseUrl } from "./apiBaseUrl";

describe("getApiBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the same-origin relative path when VITE_API_BASE_URL is genuinely unset — every local dev/test run today", () => {
    expect(import.meta.env.VITE_API_BASE_URL).toBeUndefined();
    expect(getApiBaseUrl()).toBe("/api");
  });

  it("also falls back for an empty string, not just undefined", () => {
    vi.stubEnv("VITE_API_BASE_URL", "");

    expect(getApiBaseUrl()).toBe("/api");
  });

  it("uses the configured absolute URL when the build-time env var is set", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.clintra.example.com/api");

    expect(getApiBaseUrl()).toBe("https://api.clintra.example.com/api");
  });
});
