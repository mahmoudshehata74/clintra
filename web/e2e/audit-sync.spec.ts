import { expect, test, type Page } from "@playwright/test";
import type { Invoice, Membership, Patient, Practitioner, RemoteAuditLog, SyncOp, User, Visit } from "../src/db/types";
import { cairoInstant } from "../src/domain/time";
import {
  ASSISTANT_NAME,
  bookFirstOpenSlot,
  gotoRealDay,
  gotoSeededDay,
  openAuditLog,
  PATIENTS,
  PRACTITIONER_NAME,
  readStore,
  rowFor,
  S,
  SEEDED_DAY,
  selectPractitioner,
  SLOTS_DR,
  syncSettled,
} from "./support";

// Audit rows across devices (docs/audit-sync.md), on the demo's
// FakeTransport: "another device" is a row planted in the fake server's own
// database, never in this device's — the device receives it through its
// ordinary audit pull, as from the real server.

/** The database the app's FakeTransport keeps as its stand-in server (sync/fakeTransport.ts's FAKE_SERVER_DB_NAME). */
const FAKE_SERVER_DB = "clintra-fake-server";
const OTHER_DEVICE = "e2e-other-device";

type ServerAuditRow = RemoteAuditLog & { seq: number };

/** Every row of a store in the named database. */
function readDatabase<T>(page: Page, databaseName: string, storeName: string): Promise<T[]> {
  return page.evaluate(
    async ({ name, store }) => {
      const req = indexedDB.open(name);
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const getAll = database.transaction(store, "readonly").objectStore(store).getAll();
        return await new Promise<T[]>((resolve, reject) => {
          getAll.onsuccess = () => resolve(getAll.result as T[]);
          getAll.onerror = () => reject(getAll.error);
        });
      } finally {
        database.close();
      }
    },
    { name: databaseName, store: storeName },
  );
}

/** Puts rows into stores of the fake server's database, in one transaction. */
function putServerRows(page: Page, rows: readonly { store: string; value: unknown }[]): Promise<void> {
  return page.evaluate(
    async ({ name, toPut }) => {
      const req = indexedDB.open(name);
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const transaction = database.transaction([...new Set(toPut.map((row) => row.store))], "readwrite");
        for (const row of toPut) {
          transaction.objectStore(row.store).put(row.value);
        }
        await new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve(undefined);
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { name: FAKE_SERVER_DB, toPut: rows },
  );
}

/** Waits until this device has run an audit pull, so the fake server holds its store and a cursor is set. */
async function auditPulledOnce(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const [device] = await readStore<{ audit_pull_cursor?: string | null }>(page, "device");
      return device?.audit_pull_cursor ?? null;
    })
    .not.toBeNull();
}

/** The fake server's next arrival seq. */
async function nextServerSeq(page: Page): Promise<number> {
  const rows = await readDatabase<ServerAuditRow>(page, FAKE_SERVER_DB, "remote_audit_log");
  return rows.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
}

/** Waits until this device has pulled the row with that id. */
async function pulled(page: Page, id: string): Promise<void> {
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      return (await readStore<RemoteAuditLog>(page, "remote_audit_log")).some((row) => row.id === id);
    })
    .toBe(true);
}

/** The seeded owner's membership — the practitioner, who is not the one signed in here. */
async function ownerMembership(page: Page): Promise<Membership> {
  const users = await readStore<User>(page, "users");
  const owner = users.find((user) => user.full_name === PRACTITIONER_NAME);
  const membership = (await readStore<Membership>(page, "memberships")).find((m) => m.user_id === owner?.id);
  if (!membership) {
    throw new Error("seeded owner membership not found");
  }
  return membership;
}

test("a row another device wrote today shows in the audit sheet under its filter, naming who did it", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await auditPulledOnce(page);
  const owner = await ownerMembership(page);
  const patientId = crypto.randomUUID();
  const row: ServerAuditRow = {
    id: crypto.randomUUID(),
    org_id: owner.org_id,
    location_id: null,
    practitioner_id: null,
    actor_membership_id: owner.id,
    device_id: OTHER_DEVICE,
    entity: "patients",
    entity_id: patientId,
    action: "create",
    before: null,
    after: { id: patientId, org_id: owner.org_id, full_name: "نادية من جهاز تاني" },
    at: new Date().toISOString(),
    seq: await nextServerSeq(page),
  };
  await putServerRows(page, [{ store: "remote_audit_log", value: row }]);
  await pulled(page, row.id);

  await openAuditLog(page);
  const dialog = page.getByRole("dialog");
  const listed = dialog.getByRole("listitem").filter({ hasText: "نادية من جهاز تاني" });
  await expect(listed).toHaveCount(1);
  await expect(listed.getByText("أضاف مريض", { exact: true })).toBeVisible();
  await expect(listed.getByText(PRACTITIONER_NAME, { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: S.auditFilterVisits, exact: true }).click();
  await expect(listed).toHaveCount(1);
  await dialog.getByRole("button", { name: S.auditFilterInvoices, exact: true }).click();
  await expect(listed).toHaveCount(0);
});

test("an invoice another device created names its creator on this one", async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await auditPulledOnce(page);
  const owner = await ownerMembership(page);
  const practitioner = (await readStore<Practitioner>(page, "practitioners")).find((p) => p.full_name === SLOTS_DR);
  const invoicedVisitIds = new Set((await readStore<Invoice>(page, "invoices")).map((invoice) => invoice.visit_id));
  const visit = (await readStore<Visit>(page, "visits")).find(
    (v) => v.practitioner_id === practitioner?.id && v.visit_date === SEEDED_DAY && v.status === "completed" && !invoicedVisitIds.has(v.id),
  );
  if (!visit) {
    throw new Error("no seeded completed visit without an invoice");
  }
  const patient = (await readStore<Patient>(page, "patients")).find((p) => p.id === visit.patient_id);
  const issuedAt = cairoInstant(SEEDED_DAY, "10:30");
  const invoice: Invoice = {
    id: crypto.randomUUID(),
    org_id: visit.org_id,
    location_id: visit.location_id,
    number: 1,
    issued_year: Number(SEEDED_DAY.slice(0, 4)),
    series: 2,
    patient_id: visit.patient_id,
    practitioner_id: visit.practitioner_id,
    visit_id: visit.id,
    total: 0 as Invoice["total"],
    paid: 0 as Invoice["paid"],
    status: "paid",
    issued_at: issuedAt,
    rev: 1,
  };
  const op: SyncOp = {
    op_id: crypto.randomUUID(),
    entity: "invoices",
    entity_id: invoice.id,
    action: "create",
    payload: invoice,
    device_id: OTHER_DEVICE,
    created_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
    base_rev: null,
    failure_count: 0,
    next_retry_at: null,
  };
  const auditRow: ServerAuditRow = {
    id: crypto.randomUUID(),
    org_id: visit.org_id,
    location_id: visit.location_id,
    practitioner_id: visit.practitioner_id,
    actor_membership_id: owner.id,
    device_id: OTHER_DEVICE,
    entity: "invoices",
    entity_id: invoice.id,
    action: "create",
    before: null,
    after: invoice,
    at: issuedAt,
    seq: await nextServerSeq(page),
  };
  await putServerRows(page, [
    { store: "invoices", value: invoice },
    { store: "sync_ops", value: op },
    { store: "remote_audit_log", value: auditRow },
  ]);
  await pulled(page, auditRow.id);

  const row = rowFor(page, patient?.full_name ?? "");
  await row.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(`${S.invoiceCreatedPrefix} 10:30 · ${PRACTITIONER_NAME}`)).toBeVisible();
  await expect(sheet.getByText(ASSISTANT_NAME)).toHaveCount(0);
});

test("this device's audit rows reach the server once, under its own device, and never come back as pulled rows", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.mona);
  await syncSettled(page);
  await auditPulledOnce(page);

  const own = await readStore<{ id: string; seq: number }>(page, "audit_log");
  expect(own.length).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      const [device] = await readStore<{ audit_pushed_seq?: number }>(page, "device");
      return device?.audit_pushed_seq ?? 0;
    })
    .toBe(Math.max(...own.map((row) => row.seq)));

  const onServer = await readDatabase<ServerAuditRow>(page, FAKE_SERVER_DB, "remote_audit_log");
  const ownIds = own.map((row) => row.id);
  expect(onServer.filter((row) => ownIds.includes(row.id)).map((row) => row.id).sort()).toEqual([...ownIds].sort());
  expect(new Set(onServer.map((row) => row.id)).size).toBe(onServer.length);
  expect((await readStore<RemoteAuditLog>(page, "remote_audit_log")).filter((row) => ownIds.includes(row.id))).toEqual([]);
});
