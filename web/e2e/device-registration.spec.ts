import { expect, test, type Page } from "@playwright/test";
import { gotoSeededDay, SLOTS_DR } from "./support";

/** Read every row from the `device` object store straight out of IndexedDB. */
async function readDeviceRows(page: Page): Promise<Array<{ id: string; org_id: string; location_id: string }>> {
  return page.evaluate(async () => {
    const openReq = indexedDB.open("clintra");
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
    });
    try {
      const store = database.transaction("device", "readonly").objectStore("device");
      return await new Promise<Array<{ id: string; org_id: string; location_id: string }>>((resolve, reject) => {
        const getAll = store.getAll();
        getAll.onsuccess = () => resolve(getAll.result);
        getAll.onerror = () => reject(getAll.error);
      });
    } finally {
      database.close();
    }
  });
}

test("the device identity is written on first seed and read back unchanged after a reload", async ({ page }) => {
  await gotoSeededDay(page);

  const rows = await readDeviceRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBeTruthy();
  expect(rows[0].org_id).toBeTruthy();
  expect(rows[0].location_id).toBeTruthy();
  const deviceId = rows[0].id;

  await page.reload();
  await expect(page.getByRole("button", { name: SLOTS_DR, exact: true })).toBeVisible();

  const rowsAfterReload = await readDeviceRows(page);
  expect(rowsAfterReload).toHaveLength(1);
  expect(rowsAfterReload[0].id).toBe(deviceId);
});
