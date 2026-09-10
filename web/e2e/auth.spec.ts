import { expect, test, type Page } from "@playwright/test";
import {
  ASSISTANT_NAME,
  AUTH,
  DEV_SEED_PINS,
  enterPin,
  gotoSeededDay,
  lockOverlay,
  login,
  PATIENTS,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

// A wrong PIN derived from (not equal to) the real one — never a printed
// literal secret, and guaranteed different from the assistant's dev PIN.
const WRONG_PIN = DEV_SEED_PINS.assistant === "0000" ? "1111" : "0000";

/** Navigate to a fresh, still-locked app (no login). */
async function openLocked(page: Page): Promise<void> {
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await expect(lockOverlay(page)).toBeVisible();
}

async function pickAssistant(page: Page): Promise<void> {
  await lockOverlay(page).getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
}

/** Read every row of an IndexedDB object store from the page. */
async function readStore<T>(page: Page, storeName: string): Promise<T[]> {
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

test("a fresh launch is locked; picking a membership and entering the correct PIN reveals the day screen", async ({
  page,
}) => {
  await openLocked(page);
  await pickAssistant(page);
  await enterPin(page, DEV_SEED_PINS.assistant);

  await expect(lockOverlay(page)).toBeHidden();
  await expect(page.getByRole("button", { name: SLOTS_DR, exact: true })).toBeVisible();
});

test("a wrong PIN keeps the lock screen and shows the wrong-PIN state", async ({ page }) => {
  await openLocked(page);
  await pickAssistant(page);
  await enterPin(page, WRONG_PIN);

  await expect(lockOverlay(page).getByText(AUTH.lockWrongPin)).toBeVisible();
  await expect(lockOverlay(page)).toBeVisible();
});

test("five wrong PINs start a countdown that blocks the sixth attempt until it expires", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  const overlay = lockOverlay(page);
  await expect(overlay).toBeVisible();
  await pickAssistant(page);

  for (let attempt = 0; attempt < 4; attempt++) {
    await enterPin(page, WRONG_PIN);
    await expect(overlay.getByText(AUTH.lockWrongPin)).toBeVisible();
  }
  // The fifth failure arms the cool-down.
  await enterPin(page, WRONG_PIN);
  await expect(overlay.getByText(new RegExp(AUTH.lockLockedOutPrefix))).toBeVisible();

  // The sixth attempt is blocked: the pad is disabled.
  const oneKey = overlay.getByRole("button", { name: "1", exact: true });
  await expect(oneKey).toBeDisabled();

  // Once the countdown elapses, the pad works again.
  await page.clock.fastForward(31_000);
  await expect(oneKey).toBeEnabled();
});

test("the lockout survives a page reload (sessionStorage, not memory)", async ({ page }) => {
  await openLocked(page);
  await pickAssistant(page);
  for (let attempt = 0; attempt < 5; attempt++) {
    await enterPin(page, WRONG_PIN);
  }
  await expect(lockOverlay(page).getByText(new RegExp(AUTH.lockLockedOutPrefix))).toBeVisible();

  await page.reload();
  await expect(lockOverlay(page)).toBeVisible();
  await pickAssistant(page);
  // Still counting down after a reload — the counter is keyed in sessionStorage.
  await expect(lockOverlay(page).getByText(new RegExp(AUTH.lockLockedOutPrefix))).toBeVisible();
});

test("after login, a new write's audit row carries the real acting membership, not the seed default", async ({
  page,
}) => {
  await gotoSeededDay(page); // logs in as the assistant
  await selectPractitioner(page, SLOTS_DR);

  await rowFor(page, PATIENTS.mona).locator("button").filter({ hasText: PATIENTS.mona }).click();
  await expect(page.getByText(S.attendanceMarked)).toBeVisible();

  const memberships = await readStore<{ id: string; role: string }>(page, "memberships");
  const assistant = memberships.find((membership) => membership.role === "assistant");
  const auditRows = await readStore<{ entity: string; actor_membership_id: string }>(page, "audit_log");
  const visitAudits = auditRows.filter((row) => row.entity === "visits");

  expect(visitAudits.length).toBeGreaterThan(0);
  for (const row of visitAudits) {
    expect(row.actor_membership_id).toBe(assistant?.id);
  }
});

test("the idle timeout re-locks the app without a reload", async ({ page }) => {
  await page.clock.install();
  await gotoSeededDay(page); // logs in

  await expect(lockOverlay(page)).toBeHidden();
  // Ten minutes of no interaction (docs/auth-plan.md, Layer 3).
  await page.clock.fastForward(10 * 60_000 + 1_000);
  await expect(lockOverlay(page)).toBeVisible();
});

test("a half-open booking sheet is preserved under the lock and restored on unlock", async ({ page }) => {
  await gotoSeededDay(page);
  await selectPractitioner(page, SLOTS_DR);

  await page.getByRole("button", { name: S.bookingButtonLabel, exact: true }).click();
  const sheet = page.getByRole("dialog");
  const search = sheet.getByPlaceholder(S.bookingSearchPlaceholder);
  await search.fill(PATIENTS.mona);

  // Explicit lock while the sheet is open with a typed value.
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await expect(lockOverlay(page)).toBeVisible();

  // Re-lock shows this member's pad directly (no picker); log back in.
  await login(page);
  await expect(lockOverlay(page)).toBeHidden();

  // The sheet and its typed value survived behind the overlay.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByPlaceholder(S.bookingSearchPlaceholder)).toHaveValue(PATIENTS.mona);
});
