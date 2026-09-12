import { expect, test, type Page } from "@playwright/test";
import type { Patient, SyncOp, SyncReview, Visit } from "../src/db/types";
import { emptySlotTiles, gotoSeededDay, login, PATIENTS, S, selectPractitioner, SLOTS_DR } from "./support";

/** Reads every row from an object store in the app's own "clintra" database, straight out of IndexedDB. */
async function readIndexedDbStore<T>(page: Page, storeName: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const req = indexedDB.open("clintra");
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
  }, storeName);
}

/** Writes rows directly into the app's own "clintra" database, straight into IndexedDB. */
async function putIndexedDbRows<T>(page: Page, storeName: string, rows: readonly T[]): Promise<void> {
  await page.evaluate(
    async ({ name, items }) => {
      const req = indexedDB.open("clintra");
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
    { name: storeName, items: rows },
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
  await dialog.getByRole("button").filter({ hasText: patientName }).first().click();
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
