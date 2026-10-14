import { beforeEach, describe, expect, it } from "vitest";
import { setActiveMembershipId } from "../auth/session";
import { describeAuditVerb } from "../domain/auditVerb";
import { Role } from "../domain/role";
import { auditGroupOf } from "../screens/day/auditLogFilters";
import { describeSyncReview } from "../sync/reviewSummary";
import { ClintraDatabase } from "./database";
import { PractitionerProfileError, updatePractitionerProfile } from "./practitioners";
import { seedDatabase } from "./seed";
import { AuditAction, type Practitioner, type SyncReview } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-practitioners-test-${crypto.randomUUID()}`);
});

/** Seeds, signs the owner in, and returns the seeded slots practitioner (أحمد المصري). */
async function seededAsOwner(): Promise<Practitioner> {
  await seedDatabase(db);
  const owner = (await db.memberships.toArray()).find((m) => m.role === Role.Owner);
  if (!owner) throw new Error("no seeded owner");
  setActiveMembershipId(owner.id);
  const practitioner = (await db.practitioners.toArray()).find((p) => p.full_name === "أحمد المصري");
  if (!practitioner) throw new Error("no seeded practitioner");
  return practitioner;
}

async function writesFor(practitionerId: string) {
  const auditRows = (await db.audit_log.toArray()).filter(
    (row) => row.entity === "practitioners" && row.entity_id === practitionerId,
  );
  const syncOps = (await db.sync_ops.toArray()).filter(
    (op) => op.entity === "practitioners" && op.entity_id === practitionerId,
  );
  return { auditRows, syncOps };
}

describe("seeded practitioners", () => {
  it("start with no syndicate number, at rev 1", async () => {
    await seedDatabase(db);
    for (const practitioner of await db.practitioners.toArray()) {
      expect(practitioner.syndicate_number).toBeNull();
      expect(practitioner.rev).toBe(1);
    }
  });
});

describe("updatePractitionerProfile", () => {
  it("stores the trimmed fields and writes exactly one audit row and one sync op", async () => {
    const practitioner = await seededAsOwner();

    const auditLogId = await updatePractitionerProfile(db, practitioner.id, {
      full_name: "  أحمد محمود المصري ",
      title: " استشاري العلاج الطبيعي\n",
      syndicate_number: " 12345 ",
    });

    const stored = await db.practitioners.get(practitioner.id);
    expect(stored).toEqual({
      ...practitioner,
      full_name: "أحمد محمود المصري",
      title: "استشاري العلاج الطبيعي",
      syndicate_number: "12345",
    });

    const { auditRows, syncOps } = await writesFor(practitioner.id);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].id).toBe(auditLogId);
    expect(auditRows[0].action).toBe(AuditAction.Update);
    expect(syncOps).toHaveLength(1);
    expect(syncOps[0].action).toBe(AuditAction.Update);
    expect(syncOps[0].base_rev).toBe(1);
    expect(syncOps[0].payload).toEqual(stored);
  });

  it("stores a blank title as \"\" and a blank syndicate number as null", async () => {
    const practitioner = await seededAsOwner();
    await updatePractitionerProfile(db, practitioner.id, {
      full_name: practitioner.full_name,
      title: practitioner.title,
      syndicate_number: "12345",
    });

    await updatePractitionerProfile(db, practitioner.id, { full_name: practitioner.full_name, title: "   ", syndicate_number: " \t" });

    const stored = await db.practitioners.get(practitioner.id);
    expect(stored?.title).toBe("");
    expect(stored?.syndicate_number).toBeNull();
  });

  it("refuses an empty name and writes nothing", async () => {
    const practitioner = await seededAsOwner();

    await expect(
      updatePractitionerProfile(db, practitioner.id, { full_name: "  ", title: "x", syndicate_number: "1" }),
    ).rejects.toThrow(PractitionerProfileError.NameRequired);

    expect(await db.practitioners.get(practitioner.id)).toEqual(practitioner);
    const { auditRows, syncOps } = await writesFor(practitioner.id);
    expect(auditRows).toHaveLength(0);
    expect(syncOps).toHaveLength(0);
  });

  it("accepts a syndicate number of 50 characters and refuses 51, writing nothing", async () => {
    const practitioner = await seededAsOwner();
    const fields = { full_name: practitioner.full_name, title: practitioner.title };

    await expect(
      updatePractitionerProfile(db, practitioner.id, { ...fields, syndicate_number: "1".repeat(51) }),
    ).rejects.toThrow(PractitionerProfileError.SyndicateNumberTooLong);
    expect((await writesFor(practitioner.id)).auditRows).toHaveLength(0);

    // Trimmed before it is measured.
    await updatePractitionerProfile(db, practitioner.id, { ...fields, syndicate_number: ` ${"1".repeat(50)} ` });
    expect((await db.practitioners.get(practitioner.id))?.syndicate_number).toBe("1".repeat(50));
  });

  it("refuses anyone but an owner, writing nothing", async () => {
    await seedDatabase(db);
    // The test harness's default actor is the seeded assistant.
    const practitioner = (await db.practitioners.toArray())[0];

    await expect(
      updatePractitionerProfile(db, practitioner.id, { full_name: "اسم جديد", title: "", syndicate_number: "" }),
    ).rejects.toThrow(PractitionerProfileError.NotOwner);

    expect(await db.practitioners.get(practitioner.id)).toEqual(practitioner);
    expect((await writesFor(practitioner.id)).auditRows).toHaveLength(0);
  });

  it("refuses a practitioner that does not exist", async () => {
    await seededAsOwner();

    await expect(
      updatePractitionerProfile(db, crypto.randomUUID(), { full_name: "اسم", title: "", syndicate_number: "" }),
    ).rejects.toThrow(PractitionerProfileError.NotFound);
  });

  it("writes nothing at all when nothing changes, trimming included", async () => {
    const practitioner = await seededAsOwner();

    const result = await updatePractitionerProfile(db, practitioner.id, {
      full_name: ` ${practitioner.full_name} `,
      title: `${practitioner.title}  `,
      syndicate_number: "   ",
    });

    expect(result).toBeNull();
    const { auditRows, syncOps } = await writesFor(practitioner.id);
    expect(auditRows).toHaveLength(0);
    expect(syncOps).toHaveLength(0);
  });

  it("reads in the audit log as \"عدّل بيانات الطبيب\" under the settings filter, with no field value", async () => {
    const practitioner = await seededAsOwner();
    await updatePractitionerProfile(db, practitioner.id, {
      full_name: practitioner.full_name,
      title: practitioner.title,
      syndicate_number: "98765",
    });

    const [row] = (await writesFor(practitioner.id)).auditRows;
    expect(describeAuditVerb(row)).toBe("عدّل بيانات الطبيب");
    expect(describeAuditVerb(row)).not.toContain("98765");
    expect(auditGroupOf(row.entity)).toBe("settings");
  });
});

describe("the sync review summary", () => {
  function review(reason: string): SyncReview {
    return {
      id: crypto.randomUUID(),
      op_id: crypto.randomUUID(),
      entity: "practitioners",
      entity_id: crypto.randomUUID(),
      reason,
      payload: null,
      needs_review: true,
      created_at: new Date().toISOString(),
      action: AuditAction.Update,
      base_rev: 1,
    };
  }

  it("names a refused practitioner write in Arabic", () => {
    expect(describeSyncReview(review("practitioner_not_editable"))).toBe(
      "بيانات طبيب — بيانات الطبيب دي مينفعش تتغيّر من الجهاز، غير الاسم واللقب ورقم النقابة",
    );
    expect(describeSyncReview(review("practitioner_profile_invalid"))).toBe(
      "بيانات طبيب — بيانات الطبيب دي ناقصة أو غلط: الاسم مطلوب ورقم النقابة 50 حرف بالكتير",
    );
  });
});
