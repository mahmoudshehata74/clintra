import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { registrationStrings } from "../src/auth/registrationStrings";
import { todayInCairo, weekdayOf } from "../src/domain/time";
import { login, readStore, rowFor, S, sidebar, SIDEBAR } from "../e2e/support";
import { mintCode, type LiveOrg } from "./liveServer";

export interface Device {
  name: string;
  context: BrowserContext;
  page: Page;
  /** Uncaught page errors on this device; console noise from failed requests is expected while offline. */
  errors: string[];
}

/** A new browser context registered as one more device of `org`, unlocked as its owner. */
export async function openDevice(browser: Browser, org: LiveOrg, name: string): Promise<Device> {
  const code = await mintCode(org);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const card = page.getByRole("dialog", { name: registrationStrings.formAria });
  await card.getByLabel(registrationStrings.codeLabel).fill(code);
  await card.getByLabel(registrationStrings.phoneLabel).fill(org.ownerPhone);
  await card.getByRole("button", { name: registrationStrings.submitLabel, exact: true }).click();
  await expect(page.getByText(`${registrationStrings.confirmationPrefix} ${org.clinicName}`)).toBeVisible();
  await page.getByRole("button", { name: registrationStrings.startLabel, exact: true }).click();
  await login(page, { name: org.ownerName, pin: org.ownerPin });
  await expect(page.getByRole("button", { name: org.ownerName, exact: true }).or(page.getByText(org.ownerName).first())).toBeVisible();
  return { name, context, page, errors };
}

/** Asks for a sync cycle now, as coming back to the tab does (sync/engine.ts's visibilitychange handler). */
export async function nudge(device: Device): Promise<void> {
  await device.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

/** Waits until `read` (nudging the devices each time) returns `expected`. */
export async function eventually<T>(devices: readonly Device[], read: () => Promise<T>, expected: T, message?: string): Promise<void> {
  await expect
    .poll(
      async () => {
        for (const device of devices) {
          await nudge(device);
        }
        return read();
      },
      { message, timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toEqual(expected);
}

/** Every write so far pushed: no sync op left unsent. */
export async function pushed(device: Device): Promise<boolean> {
  const ops = await readStore<{ synced_at: string | null }>(device.page, "sync_ops");
  return ops.every((op) => op.synced_at !== null);
}

/** How many day-grid rows show `name`. */
export function rowCount(device: Device, name: string): Promise<number> {
  return rowFor(device.page, name).count();
}

/** The status word on `name`'s row (one of the statuses given), or null. */
export async function rowStatus(device: Device, name: string, statuses: readonly string[]): Promise<string | null> {
  const text = (await rowFor(device.page, name).first().innerText().catch(() => "")) ?? "";
  return statuses.find((status) => text.includes(status)) ?? null;
}

/** This device's number series letter ("" for series 1), as invoiceNumber.ts shows it. */
export async function seriesLetter(device: Device): Promise<string> {
  const [row] = await readStore<{ series: number | null }>(device.page, "device");
  const series = row?.series ?? 1;
  return series === 1 ? "" : String.fromCharCode(64 + series);
}

/**
 * The organization's first device sets up what provisioning leaves out:
 * today a working day (09:00–17:00, 30-minute slots — the editor's
 * defaults) and one service, both through the owner's settings.
 */
export async function setUpClinic(device: Device): Promise<void> {
  const { page } = device;
  await sidebar(page).getByRole("button", { name: SIDEBAR.navSettings, exact: true }).click();
  const settings = page.getByRole("dialog");
  const weekday = S.weekdayNames[weekdayOf(todayInCairo())];
  const today = settings.getByRole("listitem").filter({ hasText: weekday });
  await today.getByRole("button", { name: S.hoursEditAction, exact: true }).click();
  await today.getByRole("button", { name: S.hoursAddWorkingDayAction, exact: true }).click();
  await expect(today).not.toContainText(S.hoursModeDayOff);
  await settings.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
  await settings.getByRole("button", { name: S.serviceNewAction, exact: true }).click();
  await settings.getByLabel(S.serviceNameLabel, { exact: true }).fill("كشف عام");
  await settings.getByLabel(S.serviceDurationLabel, { exact: true }).fill("30");
  await settings.getByLabel(S.serviceBasePriceLabel, { exact: true }).fill("300");
  await settings.getByRole("button", { name: S.settingsSaveAction, exact: true }).click();
  await expect(settings.getByRole("listitem").filter({ hasText: "كشف عام" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
}

/** Books a new patient into the empty slot at `time` (or the first one), as the "كشف عام" service. */
export async function bookNew(device: Device, name: string, time?: string): Promise<void> {
  const { page } = device;
  if (time) {
    await page.locator(`button[data-slot-time="${time}"]`).click();
  } else {
    await page.getByRole("button", { name: S.bookingRunButtonLabel, exact: true }).click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(S.bookingSearchPlaceholder).fill(name);
  await dialog.getByRole("button", { name: S.newPatientButtonPrefix }).click();
  await dialog.getByRole("button", { name: S.newPatientSubmitButton, exact: true }).click();
  if (!time) {
    await dialog.getByRole("button", { name: /^\d{1,2}:\d{2}$/ }).first().click();
  }
  const service = dialog.getByRole("button", { name: /^كشف عام ·/ });
  if (await service.count()) {
    await service.click();
  }
  await dialog.getByRole("button", { name: S.bookingConfirmButton, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rowFor(page, name)).toBeVisible();
}

/** The first empty slot's time on this device's grid. */
export async function firstEmptySlotTime(device: Device): Promise<string> {
  const time = await device.page.locator("button[data-slot-time]").first().getAttribute("data-slot-time");
  if (!time) {
    throw new Error("no empty slot left");
  }
  return time;
}
