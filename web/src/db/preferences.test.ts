import { beforeEach, describe, expect, it } from "vitest";
import { SYNCABLE_TABLES } from "../sync/syncableTables";
import { ClintraDatabase } from "./database";
import { loadAppearance, saveAppearance } from "./preferences";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-preferences-test-${crypto.randomUUID()}`);
});

describe("the device's appearance", () => {
  it("is null until the device chooses one", async () => {
    expect(await loadAppearance(db)).toBeNull();
  });

  it("keeps the last choice, one row per device", async () => {
    await saveAppearance(db, "dark");
    expect(await loadAppearance(db)).toBe("dark");

    await saveAppearance(db, "light");
    await saveAppearance(db, "auto");
    expect(await loadAppearance(db)).toBe("auto");
    expect(await db.preferences.toArray()).toEqual([{ key: "appearance", value: "auto" }]);
  });

  it("reads a stored value it does not know as auto", async () => {
    await db.preferences.put({ key: "appearance", value: "sepia" });
    expect(await loadAppearance(db)).toBe("auto");
  });

  it("is local-only: no sync op, no audit row, not a syncable table", async () => {
    await saveAppearance(db, "dark");
    expect(await db.sync_ops.count()).toBe(0);
    expect(await db.audit_log.count()).toBe(0);
    expect(SYNCABLE_TABLES).not.toContain("preferences");
  });
});
