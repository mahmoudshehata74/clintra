import { beforeEach, describe, expect, it } from "vitest";
import { clearActiveSession, setActiveMembershipId } from "../auth/session";
import { describeAuditVerb } from "../domain/auditVerb";
import { id } from "../domain/id";
import { formatPrescriptionNumber } from "../domain/numberSeries";
import { cairoYear } from "../domain/time";
import { VisitSource } from "../domain/visitSource";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { DEVICE_SERIES_UNKNOWN, getDeviceBinding } from "./deviceRegistration";
import {
  addPrescriptionItem,
  markPrescriptionPrinted,
  PrescriptionError,
  removePrescriptionItem,
  updatePrescriptionItem,
  type PrescriptionItemFields,
} from "./prescriptions";
import { seedDatabase } from "./seed";
import { AuditAction, type Membership, type Prescription, type PrescriptionItem, type Visit } from "./types";
import { saveVisitFormField } from "./visitForm";

let db: ClintraDatabase;
let prescriber: Membership;

const DICLOFENAC: PrescriptionItemFields = {
  name: "Diclofenac 50mg",
  form: "Tablet",
  instructions: "قرص × 2 يومياً · بعد الأكل",
  duration: "7 أيام",
  note: "يُوقف مع أي ألم في المعدة",
};
const PARACETAMOL: PrescriptionItemFields = { name: "Paracetamol 500mg", instructions: "قرص عند الحاجة" };
const VOLTAREN: PrescriptionItemFields = { name: "Voltaren Gel 1%", form: "Gel", instructions: "دهان × 3 يومياً" };

beforeEach(async () => {
  db = new ClintraDatabase(`clintra-prescriptions-test-${crypto.randomUUID()}`);
  await seedDatabase(db);
  const found = (await db.memberships.toArray()).find((membership) => membership.practitioner_id !== null);
  if (!found) throw new Error("seed did not produce a membership with a practitioner");
  prescriber = found;
  setActiveMembershipId(prescriber.id);
});

/** A visit written directly (bypassing mutate()), for the prescriber's own practitioner unless overridden. */
async function makeVisit(status: VisitStatus = VisitStatus.InRoom, overrides: Partial<Visit> = {}): Promise<Visit> {
  const practitionerId = overrides.practitioner_id ?? prescriber.practitioner_id!;
  const practitioner = await db.practitioners.get(practitionerId);
  const [location] = await db.locations.toArray();
  const [patient] = await db.patients.toArray();
  const sameDay = await db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, "2026-09-07"]).toArray();

  const visit: Visit = {
    id: id(),
    org_id: practitioner!.org_id,
    location_id: location.id,
    practitioner_id: practitionerId,
    patient_id: patient.id,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-07",
    position: sameDay.reduce((max, v) => Math.max(max, v.position), 0) + 1,
    scheduled_at: null,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: prescriber.id,
    created_at: "2026-09-07T06:00:00.000Z",
    note: null,
    rev: 1,
    ...overrides,
  };
  await db.visits.add(visit);
  return visit;
}

async function setDeviceSeries(series: number | null): Promise<void> {
  const device = await getDeviceBinding(db);
  await db.device.update(device.id, { series });
}

/** Everything a refused write must leave untouched. */
async function writeCounts() {
  return {
    auditRows: await db.audit_log.count(),
    syncOps: await db.sync_ops.count(),
    prescriptions: await db.prescriptions.count(),
    items: await db.prescription_items.count(),
  };
}

const LIFECYCLE_ORDER: readonly AuditAction[] = [AuditAction.Create, AuditAction.Update, AuditAction.Delete];

/**
 * One entity's queued ops, create before update before delete. sync_ops is
 * keyed by a random op_id, so its own iteration order means nothing, and two
 * ops written in the same millisecond tie on created_at; every test here
 * queues at most one op of each action per entity, so lifecycle order is the
 * order they were written in.
 */
async function opsFor(entity: string, entityId: string) {
  return (await db.sync_ops.toArray())
    .filter((op) => op.entity === entity && op.entity_id === entityId)
    .sort((a, b) => LIFECYCLE_ORDER.indexOf(a.action) - LIFECYCLE_ORDER.indexOf(b.action));
}

/** As the seeded assistant: not anyone's practitioner. */
function actAsAssistant(): void {
  clearActiveSession();
}

describe("addPrescriptionItem", () => {
  it("creates the prescription with its number on the first item, both audited and queued", async () => {
    const visit = await makeVisit();

    const result = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const year = cairoYear(result.prescription.created_at);
    expect(result.prescription).toEqual({
      id: result.prescription.id,
      org_id: visit.org_id,
      location_id: visit.location_id,
      visit_id: visit.id,
      patient_id: visit.patient_id,
      practitioner_id: visit.practitioner_id,
      series: 1,
      issued_year: year,
      number: 1,
      diagnosis: null,
      printed_at: null,
      created_by: prescriber.id,
      created_at: result.prescription.created_at,
      rev: 1,
    });
    expect(formatPrescriptionNumber(result.prescription)).toBe(`RX-${year}-0001`);
    expect(result.item).toEqual({ id: result.item.id, prescription_id: result.prescription.id, ...DICLOFENAC, position: 1, rev: 1 });
    expect(await db.prescriptions.get(result.prescription.id)).toEqual(result.prescription);
    expect(await db.prescription_items.get(result.item.id)).toEqual(result.item);

    const prescriptionAudit = await db.audit_log.get(result.prescriptionAuditLogId!);
    expect([prescriptionAudit?.entity, prescriptionAudit?.action, prescriptionAudit?.actor_membership_id]).toEqual([
      "prescriptions",
      AuditAction.Create,
      prescriber.id,
    ]);
    const itemAudit = await db.audit_log.get(result.itemAuditLogId);
    expect([itemAudit?.entity, itemAudit?.action]).toEqual(["prescription_items", AuditAction.Create]);
    expect((await opsFor("prescriptions", result.prescription.id)).map((op) => [op.action, op.payload])).toEqual([
      [AuditAction.Create, result.prescription],
    ]);
    expect((await opsFor("prescription_items", result.item.id)).map((op) => [op.action, op.payload])).toEqual([
      [AuditAction.Create, result.item],
    ]);
  });

  it("mints the number once per prescription: later items join it in append order", async () => {
    const visit = await makeVisit();
    const first = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const second = await addPrescriptionItem(db, visit.id, PARACETAMOL);
    const third = await addPrescriptionItem(db, visit.id, VOLTAREN);

    expect(second.prescription).toEqual(first.prescription);
    expect(third.prescription).toEqual(first.prescription);
    expect([second.prescriptionAuditLogId, third.prescriptionAuditLogId]).toEqual([null, null]);
    expect([first.item.position, second.item.position, third.item.position]).toEqual([1, 2, 3]);
    expect(await db.prescriptions.count()).toBe(1);
    expect((await db.sync_ops.toArray()).filter((op) => op.entity === "prescriptions")).toHaveLength(1);
  });

  it("numbers each visit's prescription in turn within the device's series", async () => {
    const numbers: number[] = [];
    for (let i = 0; i < 3; i++) {
      const visit = await makeVisit();
      numbers.push((await addPrescriptionItem(db, visit.id, DICLOFENAC)).prescription.number);
    }
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("numbers each series independently at one location, even interleaved", async () => {
    const minted: Array<[number, number]> = [];
    for (const series of [1, 2, 1, 2, 2, 1]) {
      await setDeviceSeries(series);
      const visit = await makeVisit();
      const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
      minted.push([prescription.series, prescription.number]);
    }

    expect(minted).toEqual([
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
      [2, 3],
      [1, 3],
    ]);
    const stored = await db.prescriptions.toArray();
    expect(stored.map((prescription) => formatPrescriptionNumber(prescription)).sort()).toEqual(
      minted.map(([series, number]) => formatPrescriptionNumber({ series, number, issued_year: stored[0].issued_year })).sort(),
    );
  });

  it("refuses a new prescription with device_series_unknown while the series is null, writing nothing", async () => {
    const visit = await makeVisit();
    await setDeviceSeries(null);
    const before = await writeCounts();

    await expect(addPrescriptionItem(db, visit.id, DICLOFENAC)).rejects.toThrow(DEVICE_SERIES_UNKNOWN);

    expect(await writeCounts()).toEqual(before);
  });

  it("still adds to an existing prescription while the series is null: nothing is minted", async () => {
    const visit = await makeVisit();
    const first = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    await setDeviceSeries(null);

    const second = await addPrescriptionItem(db, visit.id, PARACETAMOL);

    expect(second.prescription.id).toBe(first.prescription.id);
    expect(second.item.position).toBe(2);
  });

  it.each([VisitStatus.InRoom, VisitStatus.Completed])("allows a new prescription on a %s visit", async (status) => {
    const visit = await makeVisit(status);
    await expect(addPrescriptionItem(db, visit.id, DICLOFENAC)).resolves.toMatchObject({ item: { position: 1 } });
  });

  it.each([
    VisitStatus.Cancelled,
    VisitStatus.NoShow,
    VisitStatus.Rescheduled,
    VisitStatus.Booked,
    VisitStatus.Confirmed,
    VisitStatus.Arrived,
  ])("refuses a new prescription on a %s visit with visit_not_prescribable, writing nothing", async (status) => {
    const visit = await makeVisit(status);
    const before = await writeCounts();

    await expect(addPrescriptionItem(db, visit.id, DICLOFENAC)).rejects.toThrow(PrescriptionError.VisitNotPrescribable);

    expect(await writeCounts()).toEqual(before);
  });

  it("refuses a missing visit with visit_not_found, writing nothing", async () => {
    const before = await writeCounts();
    await expect(addPrescriptionItem(db, "no-such-visit", DICLOFENAC)).rejects.toThrow(PrescriptionError.VisitNotFound);
    expect(await writeCounts()).toEqual(before);
  });

  it("refuses anyone but the visit's own practitioner with not_prescriber, writing nothing", async () => {
    const ownVisit = await makeVisit();
    const ownPractitioner = (await db.practitioners.get(prescriber.practitioner_id!))!;
    const otherPractitionerId = await db.practitioners.add({ ...ownPractitioner, id: id(), full_name: "سلمى إبراهيم" });
    const otherDoctorsVisit = await makeVisit(VisitStatus.InRoom, { practitioner_id: otherPractitionerId });
    const before = await writeCounts();

    await expect(addPrescriptionItem(db, otherDoctorsVisit.id, DICLOFENAC)).rejects.toThrow(PrescriptionError.NotPrescriber);
    actAsAssistant();
    await expect(addPrescriptionItem(db, ownVisit.id, DICLOFENAC)).rejects.toThrow(PrescriptionError.NotPrescriber);

    expect(await writeCounts()).toEqual(before);
  });

  it.each([
    ["an empty name", { ...DICLOFENAC, name: "" }, PrescriptionError.NameRequired],
    ["a whitespace name", { ...DICLOFENAC, name: "  \t " }, PrescriptionError.NameRequired],
    ["empty instructions", { ...DICLOFENAC, instructions: "" }, PrescriptionError.InstructionsRequired],
    ["whitespace instructions", { ...DICLOFENAC, instructions: " \n " }, PrescriptionError.InstructionsRequired],
  ])("refuses %s, writing nothing", async (_label, fields, error) => {
    const visit = await makeVisit();
    const before = await writeCounts();

    await expect(addPrescriptionItem(db, visit.id, fields)).rejects.toThrow(error);

    expect(await writeCounts()).toEqual(before);
  });

  it("trims every field and stores a blank or missing optional field as null", async () => {
    const visit = await makeVisit();

    const { item } = await addPrescriptionItem(db, visit.id, {
      name: "  Diclofenac 50mg ",
      form: "   ",
      instructions: " قرص مرتين يومياً\n",
      duration: " 7 أيام ",
    });

    expect(item).toMatchObject({ name: "Diclofenac 50mg", form: null, instructions: "قرص مرتين يومياً", duration: "7 أيام", note: null });
  });

  it("the store itself refuses a second prescription for the same visit", async () => {
    const visit = await makeVisit();
    const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const duplicate: Prescription = { ...prescription, id: id(), number: prescription.number + 1 };
    await expect(db.prescriptions.add(duplicate)).rejects.toThrow();
  });
});

describe("updatePrescriptionItem", () => {
  it("replaces the item's fields, keeps its position, and queues an update carrying its rev", async () => {
    const visit = await makeVisit();
    const { item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const auditLogId = await updatePrescriptionItem(db, item.id, { ...DICLOFENAC, duration: " 5 أيام ", note: "" });

    const stored = await db.prescription_items.get(item.id);
    expect(stored).toEqual({ ...item, duration: "5 أيام", note: null });
    const audit = await db.audit_log.get(auditLogId!);
    expect([audit?.entity, audit?.action, audit?.before, audit?.after]).toEqual(["prescription_items", AuditAction.Update, item, stored]);
    const ops = await opsFor("prescription_items", item.id);
    expect(ops.map((op) => [op.action, op.base_rev])).toEqual([
      [AuditAction.Create, null],
      [AuditAction.Update, item.rev],
    ]);
  });

  it("writes nothing when the fields are unchanged", async () => {
    const visit = await makeVisit();
    const { item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const before = await writeCounts();

    await expect(updatePrescriptionItem(db, item.id, { ...DICLOFENAC, name: ` ${DICLOFENAC.name} ` })).resolves.toBeNull();

    expect(await writeCounts()).toEqual(before);
  });

  it("refuses a missing item, an invalid field and a writer who is not the prescriber, writing nothing", async () => {
    const visit = await makeVisit();
    const { item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const before = await writeCounts();

    await expect(updatePrescriptionItem(db, "no-such-item", DICLOFENAC)).rejects.toThrow(PrescriptionError.ItemNotFound);
    await expect(updatePrescriptionItem(db, item.id, { ...DICLOFENAC, name: " " })).rejects.toThrow(PrescriptionError.NameRequired);
    actAsAssistant();
    await expect(updatePrescriptionItem(db, item.id, PARACETAMOL)).rejects.toThrow(PrescriptionError.NotPrescriber);

    expect(await writeCounts()).toEqual(before);
    expect(await db.prescription_items.get(item.id)).toEqual(item);
  });
});

describe("removePrescriptionItem", () => {
  it("deletes the item and queues a delete op; the others keep their positions and a new one goes after the highest", async () => {
    const visit = await makeVisit();
    await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const { item: middle } = await addPrescriptionItem(db, visit.id, PARACETAMOL);
    const { prescription } = await addPrescriptionItem(db, visit.id, VOLTAREN);

    const auditLogId = await removePrescriptionItem(db, middle.id);

    expect(await db.prescription_items.get(middle.id)).toBeUndefined();
    const audit = await db.audit_log.get(auditLogId);
    expect([audit?.entity, audit?.action, audit?.before, audit?.after]).toEqual(["prescription_items", AuditAction.Delete, middle, null]);
    const deleteOps = (await opsFor("prescription_items", middle.id)).filter((op) => op.action === AuditAction.Delete);
    expect(deleteOps.map((op) => [op.payload, op.base_rev])).toEqual([[null, middle.rev]]);

    const { item: added } = await addPrescriptionItem(db, visit.id, PARACETAMOL);
    const positions = (await db.prescription_items.where("prescription_id").equals(prescription.id).toArray())
      .map((item) => item.position)
      .sort();
    expect(positions).toEqual([1, 3, 4]);
    expect(added.position).toBe(4);
  });

  it("removing every item leaves the numbered prescription in place, and it cannot be printed while empty", async () => {
    const visit = await makeVisit();
    const { prescription, item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    await removePrescriptionItem(db, item.id);

    expect(await db.prescriptions.get(prescription.id)).toEqual(prescription);
    const before = await writeCounts();
    await expect(markPrescriptionPrinted(db, prescription.id)).rejects.toThrow(PrescriptionError.Empty);
    expect(await writeCounts()).toEqual(before);
    expect((await db.prescriptions.get(prescription.id))?.printed_at).toBeNull();

    // The next visit's prescription takes the next number: the emptied one keeps its own.
    const next = await addPrescriptionItem(db, (await makeVisit()).id, DICLOFENAC);
    expect(next.prescription.number).toBe(prescription.number + 1);
  });

  it("refuses a missing item and a writer who is not the prescriber, writing nothing", async () => {
    const visit = await makeVisit();
    const { item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const before = await writeCounts();

    await expect(removePrescriptionItem(db, "no-such-item")).rejects.toThrow(PrescriptionError.ItemNotFound);
    actAsAssistant();
    await expect(removePrescriptionItem(db, item.id)).rejects.toThrow(PrescriptionError.NotPrescriber);

    expect(await writeCounts()).toEqual(before);
  });
});

describe("markPrescriptionPrinted", () => {
  it("the first print sets printed_at and snapshots the visit's diagnosis, audited as a print and queued", async () => {
    const visit = await makeVisit();
    await saveVisitFormField(db, visit.id, "diagnosis", "  التهاب وتر الرضفة ");
    const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const { prescription: printed, auditLogId } = await markPrescriptionPrinted(db, prescription.id);

    expect(printed).toEqual({ ...prescription, printed_at: printed.printed_at, diagnosis: "التهاب وتر الرضفة" });
    expect(printed.printed_at).not.toBeNull();
    expect(await db.prescriptions.get(prescription.id)).toEqual(printed);
    const audit = await db.audit_log.get(auditLogId!);
    expect(describeAuditVerb(audit!)).toBe("طبع الوصفة");
    const ops = await opsFor("prescriptions", prescription.id);
    expect(ops.map((op) => [op.action, op.base_rev, op.payload])).toEqual([
      [AuditAction.Create, null, prescription],
      [AuditAction.Update, prescription.rev, printed],
    ]);
  });

  it("snapshots a visit with no diagnosis as null", async () => {
    const visit = await makeVisit();
    const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);

    const { prescription: printed } = await markPrescriptionPrinted(db, prescription.id);

    expect(printed.diagnosis).toBeNull();
  });

  it("a later print writes nothing — no change, no audit row, no op — and returns the prescription as printed", async () => {
    const visit = await makeVisit();
    await saveVisitFormField(db, visit.id, "diagnosis", "التهاب وتر الرضفة");
    const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const { prescription: printed } = await markPrescriptionPrinted(db, prescription.id);
    await saveVisitFormField(db, visit.id, "diagnosis", "تشخيص بعد الطباعة");
    const before = await writeCounts();

    const again = await markPrescriptionPrinted(db, prescription.id);

    expect(again).toEqual({ prescription: printed, auditLogId: null });
    expect(await writeCounts()).toEqual(before);
    expect(await db.prescriptions.get(prescription.id)).toEqual(printed);
  });

  it("refuses a missing prescription and a writer who is not the prescriber, writing nothing", async () => {
    const visit = await makeVisit();
    const { prescription } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const before = await writeCounts();

    await expect(markPrescriptionPrinted(db, "no-such-prescription")).rejects.toThrow(PrescriptionError.PrescriptionNotFound);
    actAsAssistant();
    await expect(markPrescriptionPrinted(db, prescription.id)).rejects.toThrow(PrescriptionError.NotPrescriber);

    expect(await writeCounts()).toEqual(before);
  });
});

describe("the printed lock", () => {
  it("once printed, adding, editing and removing items are all refused with prescription_printed, writing nothing", async () => {
    const visit = await makeVisit();
    const { prescription, item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    const { prescription: printed } = await markPrescriptionPrinted(db, prescription.id);
    const before = await writeCounts();

    await expect(addPrescriptionItem(db, visit.id, PARACETAMOL)).rejects.toThrow(PrescriptionError.Printed);
    await expect(updatePrescriptionItem(db, item.id, PARACETAMOL)).rejects.toThrow(PrescriptionError.Printed);
    await expect(removePrescriptionItem(db, item.id)).rejects.toThrow(PrescriptionError.Printed);

    expect(await writeCounts()).toEqual(before);
    expect(await db.prescriptions.get(prescription.id)).toEqual(printed);
    expect(await db.prescription_items.get(item.id)).toEqual(item);
  });
});

describe("the audit trail", () => {
  it("never carries a drug's name or instructions, or the diagnosis, in an audit line", async () => {
    const visit = await makeVisit();
    await saveVisitFormField(db, visit.id, "diagnosis", "التهاب وتر الرضفة");
    const { prescription, item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    await addPrescriptionItem(db, visit.id, PARACETAMOL);
    await updatePrescriptionItem(db, item.id, { ...DICLOFENAC, instructions: "قرص عند اللزوم" });
    await removePrescriptionItem(db, item.id);
    await markPrescriptionPrinted(db, prescription.id);

    const rows = (await db.audit_log.toArray()).filter(
      (row) => row.entity === "prescriptions" || row.entity === "prescription_items",
    );
    const verbs = rows.sort((a, b) => a.seq - b.seq).map((row) => describeAuditVerb(row));

    expect(verbs).toEqual(["كتب وصفة", "أضاف دواء", "أضاف دواء", "عدّل دواء", "شال دواء", "طبع الوصفة"]);
    const drugText = [DICLOFENAC, PARACETAMOL].flatMap((fields) => [fields.name, fields.instructions]);
    for (const verb of verbs) {
      for (const text of [...drugText, "قرص عند اللزوم", "التهاب وتر الرضفة"]) {
        expect(verb).not.toContain(text);
      }
    }
  });
});

describe("PrescriptionItem shape", () => {
  it("is exactly the documented fields", async () => {
    const visit = await makeVisit();
    const { item } = await addPrescriptionItem(db, visit.id, DICLOFENAC);
    expect(Object.keys(item).sort()).toEqual(
      (["id", "prescription_id", "name", "form", "instructions", "duration", "note", "position", "rev"] satisfies (keyof PrescriptionItem)[]).sort(),
    );
  });
});
