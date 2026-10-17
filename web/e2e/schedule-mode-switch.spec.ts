import { expect, test, type Page } from "@playwright/test";
import { addDaysToClinicDay, cairoInstant, todayInCairo, weekdayOf, type ClockTime } from "../src/domain/time";
import {
  bookFirstOpenSlot,
  emptySlotTiles,
  gotoRealDay,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  readStore,
  reloadAs,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
  syncSettled,
  todayAt,
} from "./support";

// A doctor's slots/queue switch in the working-hours editor (docs/bug-hunt.md's
// A-03, hardening scenario 24): it takes effect from tomorrow, and today's
// grid stays as it is.

const OWNER = { name: OWNER_NAME, pin: OWNER_PIN };
const tomorrow = () => addDaysToClinicDay(todayInCairo(), 1);
const tomorrowAt = (time: ClockTime) => new Date(cairoInstant(tomorrow(), time));

async function openHoursSettings(page: Page) {
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: S.settingsHoursTab, exact: true })).toHaveAttribute("aria-pressed", "true");
  return dialog;
}

function modeSwitch(page: Page) {
  return page.getByRole("dialog").getByRole("group", { name: S.hoursModeSwitchLabel, exact: true });
}

/** The queue column's own summary, which a slots day never shows. */
const queueSummary = (page: Page) => page.getByText(S.queueSummaryCurrentTurnLabel);

test("a doctor's switch to queue leaves today's grid as it is and opens tomorrow as a queue", async ({ page }) => {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page, OWNER);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.karim, "كشف عام");
  const karimToday = (await rowFor(page, PATIENTS.karim).textContent()) ?? "";
  const emptyToday = await emptySlotTiles(page).count();
  expect(emptyToday).toBeGreaterThan(0);

  const dialog = await openHoursSettings(page);
  const group = modeSwitch(page);
  await expect(group.getByRole("button", { name: S.hoursModeSlots, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText(S.hoursModeSwitchNote, { exact: true })).toBeVisible();
  await group.getByRole("button", { name: S.hoursModeQueue, exact: true }).click();
  await expect(group.getByRole("button", { name: S.hoursModeQueue, exact: true })).toHaveAttribute("aria-pressed", "true");

  // Today's weekday keeps its slots; tomorrow's opens as a queue.
  const rows = dialog.getByRole("listitem");
  await expect(rows).toHaveCount(7);
  const todayRow = rows.filter({ hasText: S.weekdayNames[weekdayOf(todayInCairo())] });
  const tomorrowRow = rows.filter({ hasText: S.weekdayNames[weekdayOf(tomorrow())] });
  await expect(todayRow).toContainText(new RegExp(`${S.hoursModeSlots} [0-9]+${S.minutesShortUnit}`));
  await expect(tomorrowRow).toContainText(S.hoursModeQueue);

  // Read once synced: a pull still in flight can put a row back for a
  // moment before the push catches up (e2e/support.ts's syncSettled).
  await syncSettled(page);
  await expect(group.getByRole("button", { name: S.hoursModeQueue, exact: true })).toHaveAttribute("aria-pressed", "true");
  const schedules = await readStore<{ next_mode: string | null; next_mode_from: string | null; mode: string }>(page, "schedules");
  const switched = schedules.filter((schedule) => schedule.next_mode === "queue");
  expect(switched).toHaveLength(7);
  for (const schedule of switched) {
    expect(schedule).toMatchObject({ mode: "slots", next_mode_from: tomorrow() });
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowFor(page, PATIENTS.karim)).toHaveText(karimToday);
  await expect(emptySlotTiles(page)).toHaveCount(emptyToday);
  await expect(queueSummary(page)).toHaveCount(0);

  await page.clock.setSystemTime(tomorrowAt("09:00"));
  await reloadAs(page, OWNER);
  await expect(queueSummary(page)).toBeVisible();
  await expect(emptySlotTiles(page)).toHaveCount(0);
});

test("switching back before tomorrow clears the switch, and tomorrow opens in slots again", async ({ page }) => {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page, OWNER);
  await selectPractitioner(page, SLOTS_DR);

  const dialog = await openHoursSettings(page);
  const group = modeSwitch(page);
  await group.getByRole("button", { name: S.hoursModeQueue, exact: true }).click();
  await expect(group.getByRole("button", { name: S.hoursModeQueue, exact: true })).toHaveAttribute("aria-pressed", "true");
  await group.getByRole("button", { name: S.hoursModeSlots, exact: true }).click();
  await expect(group.getByRole("button", { name: S.hoursModeSlots, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("listitem").filter({ hasText: S.weekdayNames[weekdayOf(tomorrow())] }),
  ).toContainText(new RegExp(`${S.hoursModeSlots} [0-9]+${S.minutesShortUnit}`));

  await syncSettled(page);
  await expect(group.getByRole("button", { name: S.hoursModeSlots, exact: true })).toHaveAttribute("aria-pressed", "true");
  const schedules = await readStore<{ next_mode: string | null; next_mode_from: string | null; mode: string }>(page, "schedules");
  const slotsRows = schedules.filter((schedule) => schedule.mode === "slots");
  expect(slotsRows).toHaveLength(7);
  for (const schedule of slotsRows) {
    expect(schedule.next_mode).toBeNull();
    expect(schedule.next_mode_from).toBeNull();
  }

  await page.keyboard.press("Escape");
  await page.clock.setSystemTime(tomorrowAt("08:30"));
  await reloadAs(page, OWNER);
  await expect(emptySlotTiles(page).first()).toBeVisible();
  await expect(queueSummary(page)).toHaveCount(0);
});
