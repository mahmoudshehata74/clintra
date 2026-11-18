import { expect, test, type Page } from "@playwright/test";
import {
  bookFirstOpenSlot,
  gotoRealDay,
  openBookingSheet,
  openProfileFromSearch,
  PATIENTS,
  PROFILE,
  S,
  selectPractitioner,
  sidebar,
  SIDEBAR,
  SLOTS_DR,
} from "./support";

// Archiving a patient (db/patientArchive.ts) from the profile, as the
// seeded assistant: on the real day the seeded patients have only past
// visits, so any of them can be archived; one booked today cannot.

const archiveButton = (page: Page) => page.getByRole("button", { name: PROFILE.archiveAction, exact: true });
const restoreButton = (page: Page) => page.getByRole("button", { name: PROFILE.restoreAction, exact: true });

/** From an open profile on the patients page, back to its search, searching for `query`. */
async function searchAgain(page: Page, query: string) {
  await page.getByRole("button", { name: PROFILE.backToSearch, exact: true }).click();
  await page.getByPlaceholder(PROFILE.searchPlaceholder).fill(query);
}

/** The booking sheet's results for `name`, leaving out its "new patient" button. */
async function bookingResults(page: Page, name: string) {
  await openBookingSheet(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await expect(dialog.getByRole("button", { name: S.newPatientButtonPrefix })).toBeVisible();
  return dialog.getByRole("button").filter({ hasText: name }).filter({ hasNotText: S.newPatientButtonPrefix });
}

test("an archived patient leaves the searches and comes back when restored", async ({ page }) => {
  await gotoRealDay(page);
  await openProfileFromSearch(page, PATIENTS.yasmin, PATIENTS.yasmin);
  await archiveButton(page).click();
  await expect(page.getByRole("status").filter({ hasText: PROFILE.archivedLine })).toBeVisible();
  await expect(restoreButton(page)).toBeVisible();

  // The patients screen leaves her out until "إظهار المؤرشفين" is on, then marks her.
  await searchAgain(page, PATIENTS.yasmin);
  await expect(page.getByText(PROFILE.searchNoMatch, { exact: true })).toBeVisible();
  const showArchived = page.getByRole("switch", { name: PROFILE.showArchivedLabel, exact: true });
  await showArchived.click();
  await expect(showArchived).toHaveAttribute("aria-checked", "true");
  const results = page.getByRole("list", { name: PROFILE.resultsLabel, exact: true });
  const row = results.getByRole("button").filter({ hasText: PATIENTS.yasmin });
  await expect(row).toContainText(PROFILE.archivedBadge);

  // Her history stays: the profile still opens, and she can be brought back.
  await row.click();
  await expect(page.getByRole("group", { name: PROFILE.tabsLabel, exact: true })).toBeVisible();
  await restoreButton(page).click();
  await expect(archiveButton(page)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: PROFILE.archivedLine })).toHaveCount(0);

  await searchAgain(page, PATIENTS.yasmin);
  await expect(page.getByRole("list", { name: PROFILE.resultsLabel, exact: true }).getByRole("button").filter({ hasText: PATIENTS.yasmin })).not.toContainText(
    PROFILE.archivedBadge,
  );
});

test("the booking sheet never offers an archived patient", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await expect(await bookingResults(page, PATIENTS.omar)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await openProfileFromSearch(page, PATIENTS.omar, PATIENTS.omar);
  await archiveButton(page).click();
  await expect(restoreButton(page)).toBeVisible();

  await sidebar(page).getByRole("button", { name: SIDEBAR.navDay, exact: true }).click();
  await selectPractitioner(page, SLOTS_DR);
  await expect(await bookingResults(page, PATIENTS.omar)).toHaveCount(0);
});

test("a patient with a visit still to come cannot be archived, and says why", async ({ page }) => {
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.hoda);

  await openProfileFromSearch(page, PATIENTS.hoda, PATIENTS.hoda);
  await archiveButton(page).click();
  await expect(page.getByRole("alert")).toHaveText(PROFILE.archiveBlockedUpcoming);
  await expect(restoreButton(page)).toHaveCount(0);

  await searchAgain(page, PATIENTS.hoda);
  await expect(page.getByRole("list", { name: PROFILE.resultsLabel, exact: true }).getByRole("button").filter({ hasText: PATIENTS.hoda })).toBeVisible();
});
