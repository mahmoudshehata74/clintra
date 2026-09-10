import { expect, test, type Page } from "@playwright/test";
import {
  AUTH,
  emptySlotTiles,
  enterPin,
  gotoSeededDay,
  lockOverlay,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
} from "./support";

const NEW_ASSISTANT_NAME = "منى الجديدة";
const NEW_ASSISTANT_PHONE = "01099999999";
const NEW_ASSISTANT_PIN = "2468";

function openSettings(page: Page) {
  return page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
}

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

test("the owner sees the settings pill", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await expect(page.getByRole("button", { name: S.settingsButtonLabel, exact: true })).toBeVisible();
});

test("the assistant does not see the settings pill", async ({ page }) => {
  await gotoSeededDay(page); // assistant by default
  await expect(page.getByRole("button", { name: S.settingsButtonLabel, exact: true })).toHaveCount(0);
});

test("editing slot_minutes is refused on a day with visits and allowed on an empty day", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);

  await openSettings(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsHoursTab, exact: true }).click();

  // Monday (الإثنين) is the seeded visits' weekday — changing slot length is refused.
  const monday = dialog.getByRole("listitem").filter({ hasText: S.weekdayNames[1] });
  await monday.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await monday.getByRole("spinbutton").fill("45");
  await monday.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(dialog.getByText(S.hoursVisitsOnOldGridError)).toBeVisible();
  await monday.getByRole("button", { name: S.settingsCancelAction, exact: true }).click();

  // Tuesday (الثلاثاء) has no visits — the same change succeeds (editor closes).
  const tuesday = dialog.getByRole("listitem").filter({ hasText: S.weekdayNames[2] });
  await tuesday.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await tuesday.getByRole("spinbutton").fill("45");
  await tuesday.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(tuesday.getByRole("button", { name: S.hoursEditAction, exact: true })).toBeVisible();
});

test("deactivating a service hides it from the booking picker but keeps a completed invoice's name", async ({
  page,
}) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);

  // Complete كريم's visit (service استشارة متابعة) to produce an invoice.
  const karim = rowFor(page, PATIENTS.karim);
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await karim.locator("button").filter({ hasText: PATIENTS.karim }).click();
  await expect(page.getByText(S.completedToastMessage)).toBeVisible();

  // Deactivate that service in settings.
  await openSettings(page);
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
  const serviceRow = settings.getByRole("listitem").filter({ hasText: "استشارة متابعة" });
  await serviceRow.getByRole("button", { name: S.serviceActiveLabel, exact: true }).click();
  await expect(serviceRow.getByRole("button", { name: S.serviceActiveLabel, exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await settings.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  // The completed invoice still shows the original service name.
  await karim.getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
  await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
  const invoice = page.getByRole("dialog");
  await expect(invoice.getByText("استشارة متابعة")).toBeVisible();
  await invoice.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  // The booking picker no longer offers the deactivated service.
  await emptySlotTiles(page).first().click();
  const booking = page.getByRole("dialog");
  await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.mona);
  await booking.getByRole("button").filter({ hasText: PATIENTS.mona }).first().click();
  await expect(booking.getByRole("button", { name: S.bookingConfirmButton, exact: true })).toBeVisible();
  await expect(booking.getByRole("button", { name: "كشف عام", exact: true })).toBeVisible();
  await expect(booking.getByRole("button", { name: "استشارة متابعة", exact: true })).toHaveCount(0);
});

test("demoting the last owner is blocked with the Arabic explanation", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openSettings(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();

  const ownerRow = dialog.getByRole("listitem").filter({ hasText: S.roleOwner });
  await ownerRow.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await ownerRow.getByRole("button", { name: S.roleAssistant, exact: true }).click();

  await expect(ownerRow.getByText(S.staffLastOwnerError)).toBeVisible();
  await expect(ownerRow.getByRole("button", { name: S.settingsSaveAction, exact: true })).toBeDisabled();
});

test("a new assistant added in settings can log in and their bookings record their name", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);

  // Add the new assistant.
  await openSettings(page);
  const settings = page.getByRole("dialog");
  await settings.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
  await settings.getByRole("button", { name: S.staffNewAction, exact: true }).click();
  await settings.getByPlaceholder(S.staffNameLabel).fill(NEW_ASSISTANT_NAME);
  await settings.getByPlaceholder(S.staffPhoneLabel).fill(NEW_ASSISTANT_PHONE);
  await settings.getByPlaceholder(S.staffPinLabel).fill(NEW_ASSISTANT_PIN);
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByText(NEW_ASSISTANT_NAME)).toBeVisible();
  await settings.getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();

  // Lock, then the picker lists three memberships including the new one.
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  const overlay = lockOverlay(page);
  await expect(overlay).toBeVisible();
  // A re-lock shows the last person's pad directly; switch to the picker to see
  // the full membership list (now three).
  await overlay.getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await expect(overlay.getByText(NEW_ASSISTANT_NAME)).toBeVisible();

  // Log in as the new assistant with the PIN just set.
  await overlay.getByRole("button", { name: new RegExp(NEW_ASSISTANT_NAME) }).click();
  await enterPin(page, NEW_ASSISTANT_PIN);
  await expect(overlay).toBeHidden();

  // Book a patient; the audit row for it carries the new assistant's membership.
  await expect(rowFor(page, PATIENTS.mona)).toContainText(S.statusBooked);
  await emptySlotTiles(page).first().click();
  const booking = page.getByRole("dialog");
  await booking.getByPlaceholder(S.bookingSearchPlaceholder).fill(PATIENTS.omar);
  await booking.getByRole("button").filter({ hasText: PATIENTS.omar }).first().click();
  await booking.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(page.getByText(S.visitBooked)).toBeVisible();

  const users = await readStore<{ id: string; full_name: string }>(page, "users");
  const memberships = await readStore<{ id: string; user_id: string }>(page, "memberships");
  const newUser = users.find((u) => u.full_name === NEW_ASSISTANT_NAME);
  const newMembership = memberships.find((m) => m.user_id === newUser?.id);
  const auditRows = await readStore<{ entity: string; action: string; actor_membership_id: string; at: string }>(
    page,
    "audit_log",
  );
  const visitCreates = auditRows
    .filter((row) => row.entity === "visits" && row.action === "create")
    .sort((a, b) => a.at.localeCompare(b.at));
  expect(visitCreates.at(-1)?.actor_membership_id).toBe(newMembership?.id);
});
