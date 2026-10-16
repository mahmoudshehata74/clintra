import { describe, expect, it } from "vitest";
import { saveFailedStrings } from "../strings";
import { attemptSave } from "./attemptSave";

describe("attemptSave", () => {
  it("is true once the write resolves", async () => {
    await expect(attemptSave(async () => "id")).resolves.toBe(true);
  });

  it("is false, never a rejection, when the write rejects", async () => {
    await expect(attemptSave(() => Promise.reject(new Error("QuotaExceededError")))).resolves.toBe(false);
  });

  it("is false when the write throws before it returns a promise", async () => {
    await expect(
      attemptSave(() => {
        throw new Error("refused");
      }),
    ).resolves.toBe(false);
  });
});

describe("saveFailedStrings", () => {
  it("is the one shared line", () => {
    expect(saveFailedStrings.line).toBe("ماتحفظش، جرّب تاني");
  });
});
