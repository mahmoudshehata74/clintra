import { expect, test, type Page } from "@playwright/test";
import { MessageChannel } from "../src/db/types";
import { buildMessageLink } from "../src/domain/messageLink";
import { findMessageTemplate, renderTemplate } from "../src/domain/messageTemplates";
import { todayInCairo } from "../src/domain/time";
import {
  addDrug,
  AUTH,
  bookFirstOpenSlot,
  bookNewPatientWithPhone,
  closeSheet,
  gotoRealDay,
  gotoSeededDay,
  karimInRoom,
  lockOverlay,
  login,
  MSG,
  openAuditLog,
  openedUrls,
  openMessagesPage,
  openPrintSheet,
  openSendSheetFromRow,
  openVisitSheet,
  OWNER_NAME,
  OWNER_PIN,
  PATIENTS,
  printSheet,
  readClockTime,
  recordWindowOpen,
  rowFor,
  RX,
  selectPractitioner,
  sendSheet,
  sidebar,
  SIDEBAR,
  SLOTS_DR,
  todayAt,
} from "./support";

// The messages screen (reference screen 19) and the send sheet. window.open
// is recorded instead of followed (recordWindowOpen), so the wa.me link is
// asserted exactly; an sms: link is a navigation the browser hands to the
// system, seen here as the request it makes.

const LAILA = "ليلى مراد";
const LAILA_PHONE = "01001234567";
const LAILA_E164 = "+201001234567";
const LAILA_DISPLAY = "0100 123 4567";
// The seeded organization and location (db/seed.ts).
const CLINIC_NAME = "عيادة النور";
const CLINIC_PHONE = "+20221234567";

test.beforeEach(async ({ page }) => {
  await recordWindowOpen(page);
});

/** ليلى, a new patient with a phone, booked on the real day by the owner with the page clock pinned before the schedule opens. */
async function lailaBooked(page: Page): Promise<string> {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await bookNewPatientWithPhone(page, LAILA, LAILA_PHONE);
  return readClockTime(await rowFor(page, LAILA).innerText());
}

function filledTemplate(key: string, time: string): string {
  return renderTemplate(findMessageTemplate(key)!.defaultBody, {
    patient_name: LAILA,
    clinic_name: CLINIC_NAME,
    clinic_phone: CLINIC_PHONE,
    date: todayInCairo(),
    time,
    doctor_name: SLOTS_DR,
  }).text;
}

async function switchUser(page: Page, as: { name: string; pin?: string }): Promise<void> {
  await page.getByRole("button", { name: AUTH.lockButtonLabel, exact: true }).click();
  await lockOverlay(page).getByRole("button", { name: AUTH.lockSwitchUser, exact: true }).click();
  await login(page, as);
}

const templateButton = (page: Page, name: string) =>
  page.getByRole("navigation", { name: MSG.templatesHeading }).getByRole("button", { name: new RegExp(name) });
const preview = (page: Page, name: string) => page.getByRole("region", { name: `${MSG.previewPrefix} ${name}` });
const recentItems = (page: Page) => page.getByRole("region", { name: MSG.recentHeading }).getByRole("listitem");

test("the owner edits a template, sees it marked معدّل (as the assistant does, read-only), and resets it", async ({ page }) => {
  await gotoSeededDay(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await openMessagesPage(page);
  await templateButton(page, "تذكير بالموعد").click();
  await expect(templateButton(page, "تذكير بالموعد")).toHaveAttribute("aria-pressed", "true");
  const reminder = preview(page, "تذكير بالموعد");
  await expect(reminder.getByText(MSG.chipEditable, { exact: true })).toBeVisible();

  await reminder.getByRole("button", { name: MSG.editAction, exact: true }).click();
  const editor = reminder.getByLabel(MSG.editorLabel, { exact: true });
  await editor.fill("بنفكّرك بموعدك بكرة يا ");
  await reminder.getByRole("button", { name: "＋ اسم المريض", exact: true }).click();
  await expect(editor).toHaveValue("بنفكّرك بموعدك بكرة يا {{patient_name}}");
  await reminder.getByRole("button", { name: MSG.saveAction, exact: true }).click();

  await expect(reminder.getByText(MSG.chipOverridden, { exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
  await expect(reminder.getByText("بنفكّرك بموعدك بكرة يا")).toBeVisible();
  await expect(reminder.getByText("اسم المريض", { exact: true })).toBeVisible();

  // The assistant sees the override, and no way to change it.
  await switchUser(page, {});
  await expect(sidebar(page).getByRole("button", { name: SIDEBAR.navMessages, exact: true })).toHaveAttribute("aria-current", "page");
  await templateButton(page, "تذكير بالموعد").click();
  await expect(reminder.getByText(MSG.chipOverridden, { exact: true })).toBeVisible();
  await expect(reminder.getByRole("button", { name: MSG.editAction, exact: true })).toHaveCount(0);

  await switchUser(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await templateButton(page, "تذكير بالموعد").click();
  await reminder.getByRole("button", { name: MSG.editAction, exact: true }).click();
  await reminder.getByRole("button", { name: MSG.resetAction, exact: true }).click();
  await expect(reminder.getByText(MSG.chipEditable, { exact: true })).toBeVisible();
  await expect(reminder.getByText("بنفكّرك بموعدك بكرة يا")).toHaveCount(0);
  await expect(reminder.getByText(/لو مش هتقدر تيجي، كلّمنا/)).toBeVisible();
});

test("the assistant reads every template, edits none, and custom has no body", async ({ page }) => {
  await gotoSeededDay(page);
  await openMessagesPage(page);
  const booking = preview(page, "تأكيد الحجز");
  await expect(booking.getByText("اسم العيادة", { exact: true })).toBeVisible();
  await expect(booking.getByText(MSG.chipEditable, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: MSG.editAction, exact: true })).toHaveCount(0);

  await templateButton(page, "رسالة مخصصة").click();
  await expect(preview(page, "رسالة مخصصة").getByText(MSG.customBodyNote, { exact: true })).toBeVisible();
  await expect(recentItems(page)).toHaveCount(0);
  await expect(page.getByText(MSG.recentEmpty, { exact: true })).toBeVisible();
});

test("WhatsApp from the visit menu opens the exact wa.me link, lists the message as اتفتحت, marks and unmarks it, and audits it without body or phone", async ({
  page,
}) => {
  const time = await lailaBooked(page);
  const sheet = await openSendSheetFromRow(page, LAILA);
  const body = sheet.getByLabel(MSG.sendBodyLabel, { exact: true });
  const text = filledTemplate("booking_confirmation", time);
  await expect(body).toHaveValue(text);
  await expect(sheet.getByRole("status")).toHaveCount(0);
  await expect(sheet.getByRole("group", { name: MSG.sendChannelLabel }).getByRole("button", { pressed: true })).toContainText(MSG.channelWhatsApp);

  await sheet.getByRole("button", { name: MSG.openWhatsApp, exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(await openedUrls(page)).toEqual([buildMessageLink(MessageChannel.WhatsApp, LAILA_E164, text)]);
  expect(await openedUrls(page)).toEqual([`https://wa.me/201001234567?text=${encodeURIComponent(text)}`]);

  await openMessagesPage(page);
  const item = recentItems(page);
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(`${LAILA} · ${LAILA_DISPLAY}`);
  await expect(item).toContainText(`مرحباً ${LAILA}،`);
  await item.getByRole("button", { name: MSG.statusOpened, exact: true }).click();
  await expect(item.getByRole("button", { name: MSG.statusSent, exact: true })).toBeVisible();
  await item.getByRole("button", { name: MSG.statusSent, exact: true }).click();
  await expect(item.getByRole("button", { name: MSG.statusOpened, exact: true })).toBeVisible();

  await openAuditLog(page);
  const lines = page.getByRole("dialog").getByRole("listitem");
  const messageLines = lines.filter({ hasText: /فتح رسالة واتساب|علّم الرسالة إنها اتبعتت|شال علامة الإرسال/ });
  await expect(messageLines).toHaveCount(3);
  await expect(lines.filter({ hasText: "فتح رسالة واتساب" })).toContainText(LAILA);
  await expect(lines.filter({ hasText: "علّم الرسالة إنها اتبعتت" })).toHaveCount(1);
  await expect(lines.filter({ hasText: "شال علامة الإرسال" })).toHaveCount(1);
  for (const line of await messageLines.all()) {
    const shown = await line.innerText();
    expect(shown).not.toContain(LAILA_DISPLAY);
    expect(shown).not.toContain("123 4567");
    expect(shown).not.toContain("اتأكد حجزك");
  }
});

test("SMS opens the sms: link, and a missing value is a warning that does not block", async ({ page }) => {
  const time = await lailaBooked(page);
  const sheet = await openSendSheetFromRow(page, LAILA);
  await sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { name: "تذكير جلسة خطة", exact: true }).click();
  await expect(sheet.getByRole("status")).toHaveText("فيه بيانات ناقصة: الجلسة — كمّلها في النص بدل [الجلسة] قبل الإرسال");
  const text = renderTemplate(findMessageTemplate("care_plan_session_reminder")!.defaultBody, {
    patient_name: LAILA,
    clinic_name: CLINIC_NAME,
    clinic_phone: CLINIC_PHONE,
    date: todayInCairo(),
    time,
  }).text;
  await expect(sheet.getByLabel(MSG.sendBodyLabel, { exact: true })).toHaveValue(text);
  const shownBody = await sheet.getByLabel(MSG.sendBodyLabel, { exact: true }).inputValue();
  expect(shownBody).toContain("[الجلسة]");
  expect(shownBody).not.toContain("{{");

  // An edit is this message's own.
  const edited = `${text}\nمع تحيات العيادة`;
  await sheet.getByLabel(MSG.sendBodyLabel, { exact: true }).fill(edited);
  await sheet.getByRole("group", { name: MSG.sendChannelLabel }).getByRole("button", { name: MSG.channelSms, exact: true }).click();
  const smsRequest = page.waitForRequest((request) => request.url().startsWith("sms:"));
  await sheet.getByRole("button", { name: MSG.openSms, exact: true }).click();
  expect((await smsRequest).url()).toBe(`sms:${LAILA_E164}?body=${encodeURIComponent(edited)}`);
  await expect(sheet).toBeHidden();
  expect(await openedUrls(page)).toEqual([]);

  await openMessagesPage(page);
  await expect(recentItems(page)).toHaveCount(1);
  await expect(recentItems(page)).toContainText("sms");
  await expect(recentItems(page).getByRole("button", { name: MSG.statusOpened, exact: true })).toBeVisible();
});

test("a patient without a phone gets a visible refusal and nothing is written or opened", async ({ page }) => {
  await page.clock.install({ time: todayAt("08:30") });
  await gotoRealDay(page);
  await selectPractitioner(page, SLOTS_DR);
  await bookFirstOpenSlot(page, PATIENTS.mona, "كشف عام");
  const sheet = await openSendSheetFromRow(page, PATIENTS.mona);
  await sheet.getByRole("button", { name: MSG.openWhatsApp, exact: true }).click();
  await expect(sheet.getByRole("alert")).toHaveText(MSG.errorNoPhone);
  await expect(sheet).toBeVisible();
  expect(await openedUrls(page)).toEqual([]);

  await closeSheet(sheet);
  await openMessagesPage(page);
  await expect(page.getByText(MSG.recentEmpty, { exact: true })).toBeVisible();
});

test("a prescription offers WhatsApp and SMS only once printed, with its text in the message", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await karimInRoom(page);
  const workspace = await openVisitSheet(page);
  await addDrug(workspace, { name: "Amoxicillin 500mg", form: "Capsule", instructions: "كبسولة كل 8 ساعات", duration: "5 أيام" });
  const print = await openPrintSheet(page, workspace, RX.printButton);
  await expect(print.getByRole("button", { name: MSG.rxSendWhatsApp, exact: true })).toHaveCount(0);
  await expect(print.getByRole("button", { name: MSG.rxSendSms, exact: true })).toHaveCount(0);

  await print.getByRole("button", { name: RX.printAction, exact: true }).click();
  await print.getByRole("button", { name: RX.confirmPrint, exact: true }).click();
  await expect(printSheet(page).getByRole("button", { name: MSG.rxSendSms, exact: true })).toBeVisible();
  await printSheet(page).getByRole("button", { name: MSG.rxSendWhatsApp, exact: true }).click();

  const sheet = sendSheet(page);
  await expect(sheet.getByRole("group", { name: MSG.sendTemplateLabel }).getByRole("button", { pressed: true })).toHaveText("رسالة مخصصة");
  const body = sheet.getByLabel(MSG.sendBodyLabel, { exact: true });
  await expect(body).toHaveValue(/^الوصفة RX-\d{4}-\d{4}\nالمريض: كريم فتحي\n1\. Amoxicillin 500mg — Capsule: كبسولة كل 8 ساعات · لمدة 5 أيام\nد\. أحمد المصري$/);
});
