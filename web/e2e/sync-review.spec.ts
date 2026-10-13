import { expect, test, type Page } from "@playwright/test";
import type { DeviceRegistration, Patient, Prescription, PrescriptionItem, SyncOp, SyncReview, Visit } from "../src/db/types";
import { emptySlotTiles, gotoSeededDay, login, PATIENTS, pickSearchResult, S, selectPractitioner, SLOTS_DR } from "./support";

/** The database the app's FakeTransport keeps as its stand-in server (sync/fakeTransport.ts's FAKE_SERVER_DB_NAME). */
const FAKE_SERVER_DB = "clintra-fake-server";

/** Reads every row from an object store in the app's own "clintra" database (or another, by name), straight out of IndexedDB. */
async function readIndexedDbStore<T>(page: Page, storeName: string, dbName = "clintra"): Promise<T[]> {
  return page.evaluate(
    async ({ name, databaseName }) => {
      const req = indexedDB.open(databaseName);
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        const store = database.transaction(name, "readonly").objectStore(name);
        return await new Promise<T[]>((resolve, reject) => {
          const getAll = store.getAll();
          getAll.onsuccess = () => resolve(getAll.result as T[]);
          getAll.onerror = () => reject(getAll.error);
        });
      } finally {
        database.close();
      }
    },
    { name: storeName, databaseName: dbName },
  );
}

/** Writes rows directly into the app's own "clintra" database (or another, by name), straight into IndexedDB. */
async function putIndexedDbRows<T>(page: Page, storeName: string, rows: readonly T[], dbName = "clintra"): Promise<void> {
  await page.evaluate(
    async ({ name, items, databaseName }) => {
      const req = indexedDB.open(databaseName);
      const database: IDBDatabase = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction(name, "readwrite");
          const store = tx.objectStore(name);
          for (const item of items) {
            store.put(item);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        database.close();
      }
    },
    { name: storeName, items: rows, databaseName: dbName },
  );
}

/**
 * Books an empty slot for the given patient (a completely ordinary,
 * successful booking — this is not itself the conflict), then plants
 * exactly the local state a genuine `conflict_slot_taken` rejection would
 * have left behind: a still-queued, unsent sync_ops row for that same
 * visit, and the matching sync_review row runSyncCycle would have written
 * for it (docs/sync-plan.md's Q7). This is a deliberately narrower
 * simulation than a real two-device race (which sync/reviewActions.test.ts
 * and sync/fakeTransport.test.ts already cover against the real rejection
 * path) — it exists to prove the review *UI* wiring: the chip, the sheet,
 * and both actions' visible effect, reading and writing this exact same
 * IndexedDB state through the running app.
 */
async function plantLostSlotConflict(page: Page, patientName: string): Promise<{ visit: Visit; plantedOpId: string }> {
  await emptySlotTiles(page).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(patientName);
  await pickSearchResult(dialog, patientName);
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();

  // Let the real sync cycle mark this ordinary booking synced first, so
  // the sync_ops row we plant next is unambiguously the *only* unsent one
  // for this visit.
  await expect(async () => {
    const ops = await readIndexedDbStore<SyncOp>(page, "sync_ops");
    const patients = await readIndexedDbStore<Patient>(page, "patients");
    const patientId = patients.find((patient) => patient.full_name === patientName)?.id;
    const visits = await readIndexedDbStore<Visit>(page, "visits");
    const visit = visits.find((candidate) => candidate.patient_id === patientId);
    const op = ops.find((candidate) => candidate.entity_id === visit?.id);
    expect(op?.synced_at).not.toBeNull();
  }).toPass({ timeout: 10_000 });

  const patients = await readIndexedDbStore<Patient>(page, "patients");
  const patientId = patients.find((patient) => patient.full_name === patientName)?.id;
  const visits = await readIndexedDbStore<Visit>(page, "visits");
  const myVisit = visits.find((visit) => visit.patient_id === patientId);
  if (!myVisit) throw new Error(`no local visit found for ${patientName} after booking`);

  const opId = crypto.randomUUID();
  await putIndexedDbRows<SyncOp>(page, "sync_ops", [
    {
      op_id: opId,
      entity: "visits",
      entity_id: myVisit.id,
      action: "create",
      payload: myVisit,
      device_id: "e2e-test-device",
      created_at: myVisit.created_at,
      synced_at: null,
      base_rev: null,
      failure_count: 0,
      next_retry_at: null,
    },
  ]);
  await putIndexedDbRows<SyncReview>(page, "sync_review", [
    {
      id: crypto.randomUUID(),
      op_id: opId,
      entity: "visits",
      entity_id: myVisit.id,
      reason: "conflict_slot_taken",
      payload: myVisit,
      needs_review: true,
      created_at: new Date().toISOString(),
      action: "create",
      base_rev: null,
    },
  ]);

  // Dexie's liveQuery (db/useLiveQuery.ts) only reacts to writes made
  // through Dexie's own transaction machinery — a raw IDBObjectStore.put()
  // from outside it, as putIndexedDbRows deliberately does above, is
  // invisible to that reactivity. A reload forces every liveQuery to
  // re-subscribe and re-read fresh, which always sees it regardless.
  await page.reload();
  await login(page);
  await selectPractitioner(page, SLOTS_DR);

  await expect(page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toBeVisible({ timeout: 10_000 });
  return { visit: myVisit, plantedOpId: opId };
}

test("a lost slot conflict shows up in review with no server row to compare against, and 'خليها كده' keeps the patient while freeing the slot", async ({
  page,
}) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);

  const { visit: myVisit } = await plantLostSlotConflict(page, PATIENTS.hoda);

  await page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(S.syncReviewNoServerRow)).toBeVisible();

  await sheet.getByRole("button", { name: S.syncReviewKeepAction, exact: true }).click();

  // The review resolves and the chip drops back to a normal state — no
  // standing conflict left.
  await expect(page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toHaveCount(0);

  const visitsAfter = await readIndexedDbStore<Visit>(page, "visits");
  const resolved = visitsAfter.find((visit) => visit.id === myVisit.id);
  expect(resolved).toBeTruthy(); // the patient's visit record survives
  expect(resolved?.status).toBe("cancelled");
  expect(resolved?.cancel_reason).toBe("sync_conflict");
});

test("'شيلها' on a lost slot conflict removes the phantom local visit entirely", async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);

  const { visit: myVisit, plantedOpId } = await plantLostSlotConflict(page, PATIENTS.karim);

  await page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: S.syncReviewRemoveAction, exact: true }).click();

  await expect(page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toHaveCount(0);

  const visitsAfter = await readIndexedDbStore<Visit>(page, "visits");
  expect(visitsAfter.find((visit) => visit.id === myVisit.id)).toBeUndefined();

  // The planted (fake-rejected) op is gone, along with mutate()'s own
  // follow-up delete op for the row it just removed — neither should ever
  // be resent, since no server row under this id will ever exist to
  // delete. The very first, ordinary booking op is a different, already
  // *synced* row for the same entity_id from before the conflict was ever
  // planted — legitimate history, correctly left untouched by discardMine,
  // which only ever touches still-unsent ops.
  const opsAfter = await readIndexedDbStore<SyncOp>(page, "sync_ops");
  expect(opsAfter.find((op) => op.op_id === plantedOpId)).toBeUndefined();
  expect(opsAfter.some((op) => op.entity_id === myVisit.id && op.synced_at === null)).toBe(false);
});

/**
 * Asks the running sync engine for a cycle now, as coming back to the tab
 * does (sync/engine.ts's visibilitychange handler), instead of waiting for
 * its timer: the app's first cycle after a load runs before the seeded
 * device is registered, so its first real pull would otherwise only come
 * with the next tick.
 */
async function requestSyncCycle(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

async function readDevice(page: Page): Promise<DeviceRegistration> {
  const [device] = await readIndexedDbStore<DeviceRegistration>(page, "device");
  return device;
}

/** A row the fake server accepted from another device: the row in its own store, and the applied op its pullSince serves. */
async function plantServerRow<T extends { id: string }>(page: Page, entity: string, row: T, appliedAt: string): Promise<void> {
  await putIndexedDbRows(page, entity, [row], FAKE_SERVER_DB);
  await putIndexedDbRows<SyncOp>(
    page,
    "sync_ops",
    [
      {
        op_id: crypto.randomUUID(),
        entity,
        entity_id: row.id,
        action: "create",
        payload: row,
        device_id: "e2e-other-device",
        created_at: appliedAt,
        synced_at: appliedAt,
        base_rev: null,
        failure_count: 0,
        next_retry_at: null,
      },
    ],
    FAKE_SERVER_DB,
  );
}

test("a prescription another device got onto the server first replaces this device's own: the review lists its drugs with only 'تمام', and later pulls keep arriving", async ({
  page,
}) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);

  // The engine has completed a pull, so the fake server's database exists to plant into.
  await expect
    .poll(async () => {
      await requestSyncCycle(page);
      return (await readDevice(page))?.pull_cursor ?? null;
    })
    .not.toBeNull();

  const prescribedVisitIds = new Set((await readIndexedDbStore<Prescription>(page, "prescriptions")).map((rx) => rx.visit_id));
  const visit = (await readIndexedDbStore<Visit>(page, "visits")).find((candidate) => !prescribedVisitIds.has(candidate.id));
  if (!visit) throw new Error("no seeded visit without a prescription");
  const device = await readDevice(page);

  const now = Date.now();
  const prescriptionFor = (series: number, number: number, createdAt: string): Prescription => ({
    id: crypto.randomUUID(),
    org_id: visit.org_id,
    location_id: visit.location_id,
    visit_id: visit.id,
    patient_id: visit.patient_id,
    practitioner_id: visit.practitioner_id,
    series,
    issued_year: 2026,
    number,
    diagnosis: null,
    printed_at: null,
    created_by: visit.created_by,
    created_at: createdAt,
    rev: 1,
  });
  const itemFor = (prescriptionId: string, name: string, position: number): PrescriptionItem => ({
    id: crypto.randomUUID(),
    prescription_id: prescriptionId,
    name,
    form: null,
    instructions: "قرص بعد الأكل",
    duration: null,
    note: null,
    position,
    rev: 1,
  });

  // This device's own prescription for the visit, which the server refused:
  // the state runSyncCycle leaves behind — the create still queued under an
  // open rejection, its items' ops already folded into that review
  // (sync/pullCollisions.ts's foldChildOpsOfRejectedCreate).
  const mine = prescriptionFor(device.series ?? 1, 900, new Date(now - 60_000).toISOString());
  const myItems = [itemFor(mine.id, "Brufen 400mg", 1), itemFor(mine.id, "Voltaren Gel", 2)];
  const myCreateOpId = crypto.randomUUID();
  await putIndexedDbRows(page, "prescriptions", [mine]);
  await putIndexedDbRows(page, "prescription_items", myItems);
  await putIndexedDbRows<SyncOp>(page, "sync_ops", [
    {
      op_id: myCreateOpId,
      entity: "prescriptions",
      entity_id: mine.id,
      action: "create",
      payload: mine,
      device_id: device.id,
      created_at: mine.created_at,
      synced_at: null,
      base_rev: null,
      failure_count: 0,
      next_retry_at: null,
    },
  ]);
  await putIndexedDbRows<SyncReview>(page, "sync_review", [
    {
      id: crypto.randomUUID(),
      op_id: myCreateOpId,
      entity: "prescriptions",
      entity_id: mine.id,
      reason: "conflict_visit_has_prescription",
      payload: {
        row: mine,
        child_ops: myItems.map((item) => ({
          op_id: crypto.randomUUID(),
          entity: "prescription_items",
          entity_id: item.id,
          action: "create",
          payload: item,
        })),
      },
      needs_review: true,
      created_at: new Date(now).toISOString(),
      action: "create",
      base_rev: null,
    },
  ]);

  // The other device's prescription for the same visit, which the server accepted.
  const theirs = prescriptionFor(99, 1, new Date(now - 120_000).toISOString());
  const theirItem = itemFor(theirs.id, "Panadol 500mg", 1);
  await plantServerRow(page, "prescriptions", theirs, new Date(now).toISOString());
  await plantServerRow(page, "prescription_items", theirItem, new Date(now + 1).toISOString());

  // A reload makes every liveQuery re-read what was planted.
  await page.reload();
  await login(page);
  await selectPractitioner(page, SLOTS_DR);
  await expect
    .poll(async () => {
      await requestSyncCycle(page);
      return (await readIndexedDbStore<SyncReview>(page, "sync_review")).filter((review) => review.needs_review).map((review) => review.reason);
    })
    .toEqual(["displaced_by_server"]);

  await page.getByRole("button", { name: S.syncNeedsReview, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("وصفة — النسخة دي اتشالت لأن جهاز تاني سبقها على السيرفر", { exact: true })).toBeVisible();
  await expect(sheet.getByText("الأدوية: Brufen 400mg، Voltaren Gel", { exact: true })).toBeVisible();
  // One row: the displacement superseded the rejection, and it offers nothing to choose.
  await expect(sheet.getByText("الزيارة دي ليها وصفة بالفعل من جهاز تاني")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: S.syncReviewKeepAction, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: S.syncReviewRemoveAction, exact: true })).toHaveCount(0);

  await sheet.getByRole("button", { name: S.syncReviewAcknowledgeAction, exact: true }).click();
  await expect(page.getByRole("button", { name: S.syncNeedsReview, exact: true })).toHaveCount(0);

  const prescriptions = await readIndexedDbStore<Prescription>(page, "prescriptions");
  expect(prescriptions.filter((rx) => rx.visit_id === visit.id)).toEqual([theirs]);
  const items = await readIndexedDbStore<PrescriptionItem>(page, "prescription_items");
  expect(items.filter((item) => item.prescription_id === mine.id)).toEqual([]);
  expect(items.find((item) => item.id === theirItem.id)).toEqual(theirItem);
  const displacedIds = [mine.id, ...myItems.map((item) => item.id)];
  const ops = await readIndexedDbStore<SyncOp>(page, "sync_ops");
  expect(ops.filter((op) => op.synced_at === null && displacedIds.includes(op.entity_id))).toEqual([]);

  // A later change on the server still reaches this device: sync is not wedged.
  const later: Patient = {
    id: crypto.randomUUID(),
    org_id: visit.org_id,
    full_name: "مريض من الجهاز التاني",
    phone: null,
    gender: null,
    birth_year: null,
    note: null,
    created_at: new Date(now + 2).toISOString(),
    rev: 1,
  };
  await plantServerRow(page, "patients", later, new Date(now + 2).toISOString());
  await expect
    .poll(async () => {
      await requestSyncCycle(page);
      return (await readIndexedDbStore<Patient>(page, "patients")).find((patient) => patient.id === later.id) ?? null;
    })
    .toEqual(later);
});
