import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { id } from "../domain/id";
import { VisitStatus } from "../domain/visitStatus";
import { VisitSource } from "../domain/visitSource";
import type { Piastres } from "../domain/money";
import { SYNCABLE_TABLES } from "../sync/syncableTables";
import { ClintraDatabase } from "./database";
import { AuditAction, InvoiceStatus, type Invoice, type SyncOp, type Visit } from "./types";

let db: ClintraDatabase;

const ORG_ID = "org-1";
const LOCATION_ID = "location-1";
const PRACTITIONER_ID = "practitioner-1";
const PATIENT_ID = "patient-1";

function makeVisit(overrides: Partial<Visit>): Visit {
  return {
    id: id(),
    org_id: ORG_ID,
    location_id: LOCATION_ID,
    practitioner_id: PRACTITIONER_ID,
    patient_id: PATIENT_ID,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-06",
    position: 1,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: new Date().toISOString(),
    note: null,
    rev: 1,
    ...overrides,
  };
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-db-test-${crypto.randomUUID()}`);
});

describe("visits indexes", () => {
  it("returns only visits matching [org_id+location_id+visit_date+status]", async () => {
    await db.visits.bulkAdd([
      makeVisit({ position: 1, status: VisitStatus.Booked, visit_date: "2026-09-06" }),
      makeVisit({ position: 2, status: VisitStatus.Cancelled, visit_date: "2026-09-06" }),
      makeVisit({ position: 3, status: VisitStatus.Booked, visit_date: "2026-09-07" }),
    ]);

    const matches = await db.visits
      .where("[org_id+location_id+visit_date+status]")
      .equals([ORG_ID, LOCATION_ID, "2026-09-06", VisitStatus.Booked])
      .toArray();

    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe(1);
  });

  it("returns only visits matching [practitioner_id+visit_date]", async () => {
    await db.visits.bulkAdd([
      makeVisit({ position: 1, visit_date: "2026-09-06" }),
      makeVisit({ position: 2, visit_date: "2026-09-07" }),
    ]);

    const matches = await db.visits
      .where("[practitioner_id+visit_date]")
      .equals([PRACTITIONER_ID, "2026-09-06"])
      .toArray();

    expect(matches).toHaveLength(1);
    expect(matches[0].position).toBe(1);
  });

  it("rejects a second visit with the same practitioner, date and position", async () => {
    await db.visits.add(makeVisit({ position: 1 }));

    await expect(db.visits.add(makeVisit({ position: 1 }))).rejects.toThrow();
  });
});

describe("invoices index", () => {
  function makeInvoice(overrides: Partial<Invoice>): Invoice {
    return {
      id: id(),
      org_id: ORG_ID,
      location_id: LOCATION_ID,
      number: 1,
      issued_year: 2026,
      series: 1,
      patient_id: PATIENT_ID,
      practitioner_id: PRACTITIONER_ID,
      visit_id: null,
      total: 0 as Piastres,
      paid: 0 as Piastres,
      status: InvoiceStatus.Unpaid,
      issued_at: new Date().toISOString(),
      rev: 1,
      ...overrides,
    };
  }

  it("rejects a second invoice with the same location, year and number", async () => {
    await db.invoices.add(makeInvoice({ number: 1, issued_year: 2026 }));

    await expect(db.invoices.add(makeInvoice({ number: 1, issued_year: 2026 }))).rejects.toThrow();
  });

  it("allows the same location and number again in a different year — the sequence resets per calendar year", async () => {
    await db.invoices.add(makeInvoice({ number: 1, issued_year: 2026 }));

    await expect(db.invoices.add(makeInvoice({ number: 1, issued_year: 2027 }))).resolves.toBeTruthy();
  });

  it("allows the same location, year and number in another device's series", async () => {
    await db.invoices.add(makeInvoice({ number: 1, issued_year: 2026, series: 1 }));

    await expect(db.invoices.add(makeInvoice({ number: 1, issued_year: 2026, series: 2 }))).resolves.toBeTruthy();
  });
});

describe("payments index", () => {
  it("rejects a second payment with the same location and receipt_number", async () => {
    const payment = {
      id: id(),
      invoice_id: "invoice-1",
      location_id: LOCATION_ID,
      amount: 100 as Piastres,
      method: "cash" as const,
      receipt_number: "1",
      series: 1,
      note: null,
      after_close: false,
      created_by: "membership-1",
      created_at: new Date().toISOString(),
      rev: 1,
    };

    await db.payments.add(payment);
    await expect(db.payments.add({ ...payment, id: id(), invoice_id: "invoice-2" })).rejects.toThrow();
  });

  it("allows the same location and receipt_number in another device's series", async () => {
    const payment = {
      id: id(),
      invoice_id: "invoice-1",
      location_id: LOCATION_ID,
      amount: 100 as Piastres,
      method: "cash" as const,
      receipt_number: "1",
      series: 1,
      note: null,
      after_close: false,
      created_by: "membership-1",
      created_at: new Date().toISOString(),
      rev: 1,
    };

    await db.payments.add(payment);
    await expect(db.payments.add({ ...payment, id: id(), series: 2 })).resolves.toBeTruthy();
  });
});

describe("cash_close index", () => {
  it("rejects a second close for the same location and date", async () => {
    const close = {
      id: id(),
      location_id: LOCATION_ID,
      date: "2026-09-06",
      total_expected: 0 as Piastres,
      total_collected: 0 as Piastres,
      difference: 0 as Piastres,
      difference_note: null,
      closed_by: "membership-1",
      closed_at: new Date().toISOString(),
      rev: 1,
    };

    await db.cash_close.add(close);
    await expect(db.cash_close.add({ ...close, id: id() })).rejects.toThrow();
  });
});

describe("patients indexes", () => {
  it("finds a patient by full_name", async () => {
    await db.patients.bulkAdd([
      {
        id: id(),
        org_id: ORG_ID,
        full_name: "منى عبد الله",
        phone: null,
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
        rev: 1,
      },
      {
        id: id(),
        org_id: ORG_ID,
        full_name: "كريم فتحي",
        phone: "+201001234567",
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
        rev: 1,
      },
    ]);

    const byName = await db.patients.where("full_name").equals("كريم فتحي").toArray();
    expect(byName).toHaveLength(1);

    const byPhone = await db.patients.where("phone").equals("+201001234567").toArray();
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0].full_name).toBe("كريم فتحي");
  });

  it("allows two patients to share the same phone — families share phone numbers", async () => {
    await db.patients.add({
      id: id(),
      org_id: ORG_ID,
      full_name: "أحمد محمود",
      phone: "+201001234567",
      gender: null,
      birth_year: null,
      note: null,
      created_at: new Date().toISOString(),
      rev: 1,
    });

    await expect(
      db.patients.add({
        id: id(),
        org_id: ORG_ID,
        full_name: "ابن أحمد محمود",
        phone: "+201001234567",
        gender: null,
        birth_year: null,
        note: null,
        created_at: new Date().toISOString(),
        rev: 1,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("users index", () => {
  it("rejects a second user with the same phone — unlike patients, users has no household-sharing case", async () => {
    await db.users.add({
      id: id(),
      full_name: "سارة حسن",
      phone: "+201123456789",
      email: null,
      is_active: true,
    });

    await expect(
      db.users.add({
        id: id(),
        full_name: "شخص آخر",
        phone: "+201123456789",
        email: null,
        is_active: true,
      }),
    ).rejects.toThrow();
  });
});

describe("version 14: visits.note backfill", () => {
  it("backfills note: null on visits written before it, and keeps a note a row already carries", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    // Every store exactly as the current schema declares it, opened at
    // version 13 — i.e. a device's database just before this upgrade.
    const stores = Object.fromEntries(
      new ClintraDatabase(name).tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    const legacy = new Dexie(name);
    legacy.version(13).stores(stores);
    const withoutNote: Partial<Visit> & Pick<Visit, "id"> = makeVisit({ position: 1 });
    delete withoutNote.note;
    const pulledWithNote = makeVisit({ position: 2, note: "حساسية بنسلين" });
    await legacy.table("visits").bulkAdd([withoutNote, pulledWithNote]);
    legacy.close();

    const upgraded = new ClintraDatabase(name);
    const visits = await upgraded.visits.toArray();

    expect(upgraded.verno).toBe(22);
    expect(visits.find((visit) => visit.id === withoutNote.id)).toHaveProperty("note", null);
    expect(visits.find((visit) => visit.id === pulledWithNote.id)?.note).toBe("حساسية بنسلين");
    upgraded.close();
  });
});

describe("version 15: number series backfill", () => {
  it("backfills series 1 on invoices, payments and unsent ops, sets only the seed device's series, and moves the unique indexes onto series", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    // Every store as the current schema declares it, except invoices and
    // payments at their version-14 indexes — a device's database just
    // before this upgrade.
    const stores: Record<string, string> = Object.fromEntries(
      new ClintraDatabase(name).tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    stores.invoices = "id, location_id, visit_id, &[location_id+issued_year+number]";
    stores.payments = "id, invoice_id, location_id, &[location_id+receipt_number]";
    const legacy = new Dexie(name);
    legacy.version(14).stores(stores);

    const invoiceBase = {
      org_id: ORG_ID,
      location_id: LOCATION_ID,
      issued_year: 2026,
      patient_id: PATIENT_ID,
      practitioner_id: PRACTITIONER_ID,
      visit_id: null,
      total: 0,
      paid: 0,
      status: InvoiceStatus.Unpaid,
      issued_at: "2026-09-07T06:00:00.000Z",
      rev: 1,
    };
    await legacy.table("invoices").bulkAdd([
      { ...invoiceBase, id: "invoice-1", number: 1 },
      { ...invoiceBase, id: "invoice-2", number: 2 },
    ]);
    const paymentBase = {
      invoice_id: "invoice-1",
      location_id: LOCATION_ID,
      amount: 100,
      method: "cash",
      note: null,
      after_close: false,
      created_by: "membership-1",
      created_at: "2026-09-07T06:00:00.000Z",
      rev: 1,
    };
    await legacy.table("payments").bulkAdd([
      { ...paymentBase, id: "payment-1", receipt_number: "1" },
      { ...paymentBase, id: "payment-2", receipt_number: "2" },
    ]);
    const deviceBase = {
      org_id: ORG_ID,
      location_id: LOCATION_ID,
      registered_at: "2026-09-07T06:00:00.000Z",
      pull_cursor: null,
    };
    await legacy.table("device").bulkAdd([
      { ...deviceBase, id: "seed-device", membership_id: null, token: null },
      { ...deviceBase, id: "registered-device", membership_id: "membership-1", token: "1|token" },
    ]);
    const opBase = {
      action: "create",
      device_id: "registered-device",
      created_at: "2026-09-07T06:00:00.000Z",
      base_rev: null,
      failure_count: 0,
      next_retry_at: null,
    };
    await legacy.table("sync_ops").bulkAdd([
      { ...opBase, op_id: "op-unsent-invoice", entity: "invoices", entity_id: "invoice-2", payload: { id: "invoice-2", number: 2 }, synced_at: null },
      { ...opBase, op_id: "op-sent-invoice", entity: "invoices", entity_id: "invoice-1", payload: { id: "invoice-1", number: 1 }, synced_at: "2026-09-07T06:01:00.000Z" },
      { ...opBase, op_id: "op-unsent-payment", entity: "payments", entity_id: "payment-2", payload: { id: "payment-2", receipt_number: "2" }, synced_at: null },
      { ...opBase, op_id: "op-unsent-visit", entity: "visits", entity_id: "visit-1", payload: { id: "visit-1" }, synced_at: null },
    ]);
    legacy.close();

    const upgraded = new ClintraDatabase(name);

    expect(upgraded.verno).toBe(22);
    expect((await upgraded.invoices.toArray()).map((invoice) => invoice.series)).toEqual([1, 1]);
    expect((await upgraded.payments.toArray()).map((payment) => payment.series)).toEqual([1, 1]);
    expect((await upgraded.device.get("seed-device"))?.series).toBe(1);
    expect((await upgraded.device.get("registered-device"))?.series).toBeNull();

    expect((await upgraded.sync_ops.get("op-unsent-invoice"))?.payload).toEqual({ id: "invoice-2", number: 2, series: 1 });
    expect((await upgraded.sync_ops.get("op-unsent-payment"))?.payload).toEqual({ id: "payment-2", receipt_number: "2", series: 1 });
    expect((await upgraded.sync_ops.get("op-sent-invoice"))?.payload).toEqual({ id: "invoice-1", number: 1 });
    expect((await upgraded.sync_ops.get("op-unsent-visit"))?.payload).toEqual({ id: "visit-1" });

    // The new indexes: the same number is free in another series, still
    // taken in series 1.
    const fresh = { ...invoiceBase, total: 0 as Piastres, paid: 0 as Piastres, number: 1 };
    await expect(upgraded.invoices.add({ ...fresh, id: "invoice-3", series: 2 })).resolves.toBe("invoice-3");
    await expect(upgraded.invoices.add({ ...fresh, id: "invoice-4", series: 1 })).rejects.toThrow();
    const freshPayment = { ...paymentBase, amount: 100 as Piastres, method: "cash" as const, receipt_number: "1" };
    await expect(upgraded.payments.add({ ...freshPayment, id: "payment-3", series: 2 })).resolves.toBe("payment-3");
    await expect(upgraded.payments.add({ ...freshPayment, id: "payment-4", series: 1 })).rejects.toThrow();
    upgraded.close();
  });
});

describe("version 17: practitioners' syndicate_number and rev backfill", () => {
  it("backfills syndicate_number null and rev 1 on practitioners written before it, and keeps values a row already carries", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    const stores = Object.fromEntries(
      new ClintraDatabase(name).tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    const legacy = new Dexie(name);
    legacy.version(16).stores(stores);
    const base = { org_id: ORG_ID, user_id: null, specialty_id: "spec-1", is_active: true };
    const local = { ...base, id: "practitioner-local", full_name: "أحمد المصري", title: "طبيب عام" };
    const pulled = {
      ...base,
      id: "practitioner-pulled",
      full_name: "سلمى إبراهيم",
      title: "",
      syndicate_number: "12345",
      rev: 4,
    };
    await legacy.table("practitioners").bulkAdd([local, pulled]);
    legacy.close();

    const upgraded = new ClintraDatabase(name);
    const practitioners = await upgraded.practitioners.toArray();

    expect(upgraded.verno).toBe(22);
    expect(practitioners.find((p) => p.id === local.id)).toEqual({ ...local, syndicate_number: null, rev: 1 });
    expect(practitioners.find((p) => p.id === pulled.id)).toEqual(pulled);
    upgraded.close();
  });
});

describe("version 18: messages and message_templates", () => {
  it("adds both stores with their indexes, one template override per key", async () => {
    const local = new ClintraDatabase(`clintra-db-messages-test-${crypto.randomUUID()}`);
    expect(local.verno).toBe(22);
    expect(local.messages.schema.indexes.map((index) => index.src).sort()).toEqual([
      "attempted_at",
      "location_id",
      "patient_id",
    ]);
    const keyIndex = local.message_templates.schema.indexes.map((index) => [index.src, index.unique]);
    expect(keyIndex).toEqual([["&key", true]]);

    const override = {
      org_id: ORG_ID,
      key: "booking_confirmation",
      body: "نص",
      updated_by: "membership-1",
      updated_at: "2026-10-13T08:00:00.000Z",
      rev: 1,
    };
    await local.message_templates.add({ ...override, id: "template-1" });
    await expect(local.message_templates.add({ ...override, id: "template-2" })).rejects.toThrow();
    local.close();
  });
});

describe("version 19: number high-water marks", () => {
  it("initialises every device's marks from the numbers already in the local store", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    const stores = Object.fromEntries(
      new ClintraDatabase(name).tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    const legacy = new Dexie(name);
    legacy.version(18).stores(stores);
    const invoiceBase = { org_id: ORG_ID, location_id: LOCATION_ID, visit_id: "visit-1", patient_id: PATIENT_ID, practitioner_id: PRACTITIONER_ID, total: 0, paid: 0, status: InvoiceStatus.Unpaid, issued_at: "2026-09-07T06:00:00.000Z", rev: 1 };
    await legacy.table("invoices").bulkAdd([
      { ...invoiceBase, id: "invoice-1", issued_year: 2025, series: 2, number: 9 },
      { ...invoiceBase, id: "invoice-2", issued_year: 2026, series: 2, number: 3 },
      { ...invoiceBase, id: "invoice-3", issued_year: 2026, series: 2, number: 5 },
    ]);
    const paymentBase = { invoice_id: "invoice-1", location_id: LOCATION_ID, amount: 100, method: "cash", series: 2, note: null, after_close: false, created_by: "membership-1", created_at: "2026-09-07T06:00:00.000Z", rev: 1 };
    await legacy.table("payments").bulkAdd([
      { ...paymentBase, id: "payment-1", receipt_number: "10" },
      { ...paymentBase, id: "payment-2", receipt_number: "9" },
    ]);
    await legacy.table("prescriptions").add({
      id: "rx-1", org_id: ORG_ID, location_id: LOCATION_ID, visit_id: "visit-1", patient_id: PATIENT_ID, practitioner_id: PRACTITIONER_ID,
      series: 2, issued_year: 2026, number: 7, diagnosis: null, printed_at: null, created_by: "membership-1", created_at: "2026-09-07T06:00:00.000Z", rev: 1,
    });
    await legacy.table("device").add({
      id: "device-1", org_id: ORG_ID, location_id: LOCATION_ID, registered_at: "2026-09-07T06:00:00.000Z",
      pull_cursor: null, membership_id: null, token: null, series: 2,
    });
    legacy.close();

    const upgraded = new ClintraDatabase(name);
    expect(upgraded.verno).toBe(22);
    expect((await upgraded.device.get("device-1"))?.number_marks).toEqual({
      [`invoice:${LOCATION_ID}:2:2025`]: 9,
      [`invoice:${LOCATION_ID}:2:2026`]: 5,
      [`receipt:${LOCATION_ID}:2`]: 10,
      [`prescription:${LOCATION_ID}:2:2026`]: 7,
    });
    upgraded.close();
  });
});

describe("version 20: care plans", () => {
  it("indexes care_plans by patient and practitioner and care_plan_items by plan and visit, none of them unique", async () => {
    const local = new ClintraDatabase(`clintra-db-care-plans-test-${crypto.randomUUID()}`);
    expect(local.verno).toBe(22);
    expect(local.care_plans.schema.indexes.map((index) => [index.src, index.unique])).toEqual([
      ["patient_id", false],
      ["practitioner_id", false],
    ]);
    expect(local.care_plan_items.schema.indexes.map((index) => [index.src, index.unique])).toEqual([
      ["care_plan_id", false],
      ["visit_id", false],
    ]);

    // Two sessions may carry no visit, and a lookup by visit finds the one linked.
    const session = { care_plan_id: "plan-1", service_id: "service-1", min_gap_days: 0, depends_on_item_id: null, price: 100, status: "planned", rev: 1 };
    await local.care_plan_items.bulkAdd([
      { ...session, id: "item-1", sequence: 1, visit_id: null },
      { ...session, id: "item-2", sequence: 2, visit_id: null },
      { ...session, id: "item-3", sequence: 3, visit_id: "visit-1" },
    ] as never);
    expect((await local.care_plan_items.where("visit_id").equals("visit-1").toArray()).map((item) => item.id)).toEqual(["item-3"]);
    local.close();
  });

  it("upgrades a version 19 database with its rows untouched", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    const current = new ClintraDatabase(name);
    const stores = Object.fromEntries(
      current.tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    current.close();
    stores.care_plans = "id";
    stores.care_plan_items = "id";
    const legacy = new Dexie(name);
    legacy.version(19).stores(stores);
    await legacy.table("patients").add({ id: PATIENT_ID, org_id: ORG_ID, full_name: "كريم", phone: null, created_at: "2026-09-07T06:00:00.000Z", rev: 1 });
    legacy.close();

    const upgraded = new ClintraDatabase(name);
    expect(upgraded.verno).toBe(22);
    expect((await upgraded.patients.get(PATIENT_ID))?.full_name).toBe("كريم");
    expect(await upgraded.care_plans.count()).toBe(0);
    expect(await upgraded.care_plan_items.where("visit_id").equals("visit-1").count()).toBe(0);
    upgraded.close();
  });
});

describe("syncable tables", () => {
  it("every table the sync endpoints carry is a local store", () => {
    const local = new ClintraDatabase(`clintra-db-syncable-test-${crypto.randomUUID()}`);
    const storeNames = local.tables.map((table) => table.name);
    for (const table of SYNCABLE_TABLES) {
      expect(storeNames).toContain(table);
    }
  });
});

describe("version 21: a device stuck on a locally added staff member", () => {
  function op(overrides: Partial<SyncOp> & Pick<SyncOp, "op_id" | "entity" | "entity_id">): SyncOp {
    return {
      action: AuditAction.Create,
      payload: { id: overrides.entity_id },
      device_id: "device-1",
      created_at: "2026-10-14T09:00:00.000Z",
      synced_at: null,
      base_rev: null,
      failure_count: 0,
      next_retry_at: null,
      ...overrides,
    };
  }

  it("drops the queued users op and the queued ops of the membership and links written with it, and keeps every other op", async () => {
    const name = `clintra-db-upgrade-test-${crypto.randomUUID()}`;
    const stores = Object.fromEntries(
      new ClintraDatabase(name).tables.map((table) => [
        table.name,
        [table.schema.primKey.src, ...table.schema.indexes.map((index) => index.src)].join(", "),
      ]),
    );
    const legacy = new Dexie(name);
    legacy.version(20).stores(stores);
    await legacy.table("sync_ops").bulkAdd([
      // The stuck local add: user, membership, its two links, then a PIN change on it.
      op({ op_id: "op-user", entity: "users", entity_id: "user-new", payload: { id: "user-new", full_name: "منى" } }),
      op({ op_id: "op-membership", entity: "memberships", entity_id: "membership-new", payload: { id: "membership-new", user_id: "user-new" } }),
      op({ op_id: "op-location-link", entity: "membership_locations", entity_id: "ml-new", payload: { id: "ml-new", membership_id: "membership-new" } }),
      op({ op_id: "op-practitioner-link", entity: "membership_practitioners", entity_id: "mp-new", payload: { id: "mp-new", membership_id: "membership-new" } }),
      op({ op_id: "op-membership-pin", entity: "memberships", entity_id: "membership-new", action: AuditAction.Update, base_rev: 1, payload: { id: "membership-new", user_id: "user-new" } }),
      // Everything else stays: the day's own work, an existing member's edit and its link, and sent history.
      op({ op_id: "op-visit", entity: "visits", entity_id: "visit-1" }),
      op({ op_id: "op-existing-membership", entity: "memberships", entity_id: "membership-old", action: AuditAction.Update, base_rev: 2, payload: { id: "membership-old", user_id: "user-old" } }),
      op({ op_id: "op-existing-link", entity: "membership_locations", entity_id: "ml-old", payload: { id: "ml-old", membership_id: "membership-old" } }),
      op({ op_id: "op-sent-user", entity: "users", entity_id: "user-sent", synced_at: "2026-10-01T09:00:00.000Z" }),
    ]);
    await legacy.table("memberships").add({ id: "membership-new", user_id: "user-new", org_id: "org-1", role: "assistant", location_scope: "all", practitioner_scope: "all", practitioner_id: null, pin_hash: "h", pin_salt: "s", is_active: true, rev: 1 });
    legacy.close();

    const upgraded = new ClintraDatabase(name);
    const remaining = (await upgraded.sync_ops.toArray()).map((row) => row.op_id).sort();

    expect(upgraded.verno).toBe(22);
    expect(remaining).toEqual(["op-existing-link", "op-existing-membership", "op-sent-user", "op-visit"]);
    // Only the queue is touched: the member can still sign in on this device.
    expect(await upgraded.memberships.get("membership-new")).toBeDefined();
    upgraded.close();
  });
});
