import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "../../db/database";
import { seedDatabase } from "../../db/seed";
import { submitNewPatientForm } from "./newPatientSubmission";
import type { NewPatientFormState } from "./newPatientForm";

let db: ClintraDatabase;
let orgId: string;

function form(overrides: Partial<NewPatientFormState>): NewPatientFormState {
  return { fullName: "", phone: "", phoneOmitted: false, ...overrides };
}

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-new-patient-submission-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  const [membership] = await db.memberships.toArray();
  orgId = membership.org_id;
});

describe("submitNewPatientForm", () => {
  it("writes a patient when submitted with only a name", async () => {
    const before = await db.patients.count();
    const result = await submitNewPatientForm(db, orgId, form({ fullName: "أحمد محمود" }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.patient.full_name).toBe("أحمد محمود");
    expect(result.patient.phone).toBeNull();
    expect(await db.patients.count()).toBe(before + 1);
  });

  it("writes a patient with a normalised phone when submitted with a name and phone", async () => {
    const result = await submitNewPatientForm(
      db,
      orgId,
      form({ fullName: "أحمد محمود", phone: "01001234567" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.patient.phone).toBe("+201001234567");
  });

  it("writes a null phone when 'من غير رقم' is active", async () => {
    const result = await submitNewPatientForm(
      db,
      orgId,
      form({ fullName: "أحمد محمود", phone: "01001234567", phoneOmitted: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.patient.phone).toBeNull();
  });

  it("rejects a malformed phone in-form and writes nothing", async () => {
    const before = await db.patients.count();
    const result = await submitNewPatientForm(db, orgId, form({ fullName: "أحمد محمود", phone: "123" }));

    expect(result).toEqual({ ok: false, nameError: null, phoneError: expect.any(String) });
    expect(await db.patients.count()).toBe(before);
  });

  it("rejects an empty name and writes nothing", async () => {
    const before = await db.patients.count();
    const result = await submitNewPatientForm(db, orgId, form({ fullName: "   " }));

    expect(result).toEqual({ ok: false, nameError: expect.any(String), phoneError: null });
    expect(await db.patients.count()).toBe(before);
  });
});
