import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import { seedDatabase } from "./seed";
import { AuditAction, type Visit } from "./types";
import { setVisitNote } from "./visitNote";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-visit-note-test-${crypto.randomUUID()}`);
});

async function firstSeededVisit(): Promise<Visit> {
  await seedDatabase(db);
  const visit = (await db.visits.toArray()).find((v) => v.position === 1);
  if (!visit) throw new Error("seed did not produce a visit at position 1");
  return visit;
}

async function writesFor(visitId: string) {
  const auditRows = (await db.audit_log.toArray()).filter((row) => row.entity === "visits" && row.entity_id === visitId);
  const syncOps = (await db.sync_ops.toArray()).filter((op) => op.entity === "visits" && op.entity_id === visitId);
  return { auditRows, syncOps };
}

describe("setVisitNote", () => {
  it("seeded visits start with no note", async () => {
    const visit = await firstSeededVisit();
    expect(visit.note).toBeNull();
  });

  it("stores the trimmed note and writes exactly one audit row and one sync op", async () => {
    const visit = await firstSeededVisit();

    const auditLogId = await setVisitNote(db, visit.id, "  ضغط مرتفع، متابعة بعد أسبوع \n");

    const stored = await db.visits.get(visit.id);
    expect(stored?.note).toBe("ضغط مرتفع، متابعة بعد أسبوع");

    const { auditRows, syncOps } = await writesFor(visit.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].id).toBe(auditLogId);
    expect(auditRows[0].action).toBe(AuditAction.Update);
    expect((auditRows[0].before as Visit).note).toBeNull();
    expect((auditRows[0].after as Visit).note).toBe("ضغط مرتفع، متابعة بعد أسبوع");

    expect(syncOps).toHaveLength(1);
    expect(syncOps[0].action).toBe(AuditAction.Update);
    expect(syncOps[0].base_rev).toBe(visit.rev);
    expect((syncOps[0].payload as Visit).note).toBe("ضغط مرتفع، متابعة بعد أسبوع");
  });

  it("changes nothing else about the visit", async () => {
    const visit = await firstSeededVisit();

    await setVisitNote(db, visit.id, "حساسية بنسلين");

    const stored = await db.visits.get(visit.id);
    expect(stored).toEqual({ ...visit, note: "حساسية بنسلين" });
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   \t\n "],
    ["null", null],
  ])("stores null for %s, clearing an existing note", async (_label, input) => {
    const visit = await firstSeededVisit();
    await setVisitNote(db, visit.id, "ملاحظة قديمة");

    const auditLogId = await setVisitNote(db, visit.id, input);

    expect(auditLogId).not.toBeNull();
    expect((await db.visits.get(visit.id))?.note).toBeNull();
    const { auditRows, syncOps } = await writesFor(visit.id);
    expect(auditRows).toHaveLength(2);
    expect(syncOps).toHaveLength(2);
  });

  it("rejects a missing visit and writes nothing", async () => {
    await seedDatabase(db);
    const auditCount = await db.audit_log.count();
    const opCount = await db.sync_ops.count();

    await expect(setVisitNote(db, "no-such-visit", "ملاحظة")).rejects.toThrow("visit_not_found");

    expect(await db.audit_log.count()).toBe(auditCount);
    expect(await db.sync_ops.count()).toBe(opCount);
  });

  it("is a no-op when the note is unchanged after trimming: no audit row, no sync op", async () => {
    const visit = await firstSeededVisit();
    await setVisitNote(db, visit.id, "حساسية بنسلين");

    const result = await setVisitNote(db, visit.id, "  حساسية بنسلين  ");

    expect(result).toBeNull();
    const { auditRows, syncOps } = await writesFor(visit.id);
    expect(auditRows).toHaveLength(1);
    expect(syncOps).toHaveLength(1);
  });

  it("is a no-op when clearing a note that is already empty", async () => {
    const visit = await firstSeededVisit();

    expect(await setVisitNote(db, visit.id, "")).toBeNull();
    expect(await setVisitNote(db, visit.id, null)).toBeNull();

    const { auditRows, syncOps } = await writesFor(visit.id);
    expect(auditRows).toHaveLength(0);
    expect(syncOps).toHaveLength(0);
  });
});
