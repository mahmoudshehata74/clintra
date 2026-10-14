import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { registrationStrings } from "../src/auth/registrationStrings";
import { addDaysToClinicDay, cairoInstant, type ClockTime } from "../src/domain/time";
import {
  advanceRowTo,
  ASSISTANT_NAME,
  auditDayFixture,
  carePlanSheetFixture,
  DEV_SEED_PINS,
  doctorDayFixture,
  emptySlotTiles,
  fillWorkspace,
  gotoSeededDay,
  karimInRoom,
  karimPrescriptionPreview,
  karimProfileFixture,
  karimWorkspaceWithHistory,
  invoiceTotals,
  labeledRowValue,
  lockOverlay,
  login,
  messagesPageFixture,
  MSG,
  openFreshInvoice,
  openProfileFromSearch,
  OWNER_NAME,
  OWNER_PIN,
  parsePounds,
  PATIENTS,
  putRows,
  QUEUE_DR,
  readStore,
  recordHalfPayment,
  reloadAs,
  rowFor,
  S,
  selectPractitioner,
  SLOTS_DR,
  syncSettled,
} from "./support";

// Side-by-side comparison of the app against the prototype, screen by
// screen. Not part of the interaction run: playwright.config.ts ignores this
// file, and only `pnpm test:compare` (playwright.compare.config.ts) runs it.
// Every test writes one PNG into e2e/compare/ (gitignored): the prototype's
// own section (#sN, opened from disk) under proto/, and the app driven to
// the state that best matches it under app/; index.html puts each pair side
// by side.

const OUT_DIR = "e2e/compare";
const PROTOTYPE_URL = pathToFileURL(path.resolve("../docs/reference/clintra-prototype.html")).href;

// The capture day for the app scenarios that pin no day of their own: the
// seeded Monday (?seedDay=1) is the Monday before it.
const COMPARE_DAY = "2026-10-14";
const compareAt = (time: ClockTime) => new Date(cairoInstant(COMPARE_DAY, time));

interface Screen {
  /** The prototype's section number (#sN). */
  readonly n: number;
  readonly title: string;
  /** What the app capture shows, when the section shows more than one thing or the state needs saying. */
  readonly captured: string;
  /** Drives the app to the matching state and resolves to what to capture: an element, or the whole page. */
  readonly drive: (page: Page) => Promise<Locator | "page">;
}

const SCREENS: readonly Screen[] = [
  {
    n: 1,
    title: "PIN lock",
    captured: "The lock overlay's PIN pad for the assistant, two digits keyed in (as the prototype's two filled dots).",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await page.goto("/?seedDay=1");
      await page.evaluate(() => localStorage.clear());
      const overlay = lockOverlay(page);
      await overlay.getByRole("button", { name: new RegExp(ASSISTANT_NAME) }).click();
      for (const digit of DEV_SEED_PINS.assistant.slice(0, 2)) {
        await overlay.getByRole("button", { name: digit, exact: true }).click();
      }
      return overlay;
    },
  },
  {
    n: 2,
    title: "Day — slots",
    captured: "The whole page: the seeded Monday for the slots doctor, كريم called in (an in-room row, as the prototype).",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await advanceRowTo(page, PATIENTS.karim, S.statusInRoom);
      return "page";
    },
  },
  {
    n: 3,
    title: "Day — queue",
    captured: "The whole page: the seeded Monday for the queue doctor.",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      await selectPractitioner(page, QUEUE_DR);
      await expect(page.getByText(S.queueSummaryCurrentTurnLabel)).toBeVisible();
      return "page";
    },
  },
  {
    n: 4,
    title: "New booking",
    captured: "The booking sheet opened from the first empty slot, searching «كريم» (the prototype's search-and-pick state).",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await emptySlotTiles(page).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByPlaceholder(S.bookingSearchPlaceholder).fill("كريم");
      await expect(sheet.getByRole("button").filter({ hasText: PATIENTS.karim }).filter({ hasNotText: S.newPatientButtonPrefix })).toBeVisible();
      return sheet;
    },
  },
  {
    n: 5,
    title: "Invoice",
    captured: "The invoice sheet, partially paid (half the total recorded in cash), as the prototype.",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      const invoice = await openFreshInvoice(page);
      await recordHalfPayment(page, invoice);
      return page.getByRole("dialog");
    },
  },
  {
    n: 6,
    title: "Payment and receipt",
    captured: "The payment sheet over a partially paid invoice, the remaining amount typed in.",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      const invoice = await openFreshInvoice(page);
      await recordHalfPayment(page, invoice);
      const remaining = parsePounds(await labeledRowValue(page.getByRole("dialog"), S.invoiceRemainingLabel));
      await page.getByRole("dialog").getByRole("button", { name: S.recordPaymentAction }).click();
      const payment = page.getByRole("dialog").filter({ hasText: S.paymentMethodLabel });
      await payment.getByRole("textbox").first().fill(remaining.toFixed(2));
      return payment;
    },
  },
  {
    n: 7,
    title: "Cash close",
    captured: "The cash close sheet on the real day after one visit paid in full in cash, the drawer amount matching.",
    drive: async (page) => {
      await karimInRoom(page);
      await advanceRowTo(page, PATIENTS.karim, S.statusCompleted);
      await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.menuOpenAriaLabel, exact: true }).click();
      await page.getByRole("menuitem", { name: S.invoiceMenuLabel, exact: true }).click();
      const invoice = page.getByRole("dialog");
      const total = parsePounds(await labeledRowValue(invoiceTotals(invoice), S.invoiceTotalLabel));
      await invoice.getByRole("button", { name: S.recordPaymentAction }).click();
      const payment = page.getByRole("dialog").filter({ hasText: S.paymentMethodLabel });
      await payment.getByRole("textbox").first().fill(total.toFixed(2));
      await payment.getByRole("button", { name: S.paymentConfirmButton, exact: true }).click();
      await expect(page.getByText(S.invoiceStatusPaid)).toBeVisible();
      await page.getByRole("dialog").getByRole("button", { name: S.sheetCloseAriaLabel, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await page.getByRole("button", { name: S.cashCloseButtonLabel, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByPlaceholder(S.cashCloseCollectedPlaceholder).fill(String(total));
      await expect(sheet.getByText(S.cashCloseMatchedTitle)).toBeVisible();
      return sheet;
    },
  },
  {
    n: 8,
    title: "Tomorrow's sheet",
    captured: "The tomorrow's-sheet preview: the seeded Monday's slots-doctor visits written again as tomorrow's bookings.",
    drive: async (page) => {
      await page.clock.install({ time: compareAt("10:00") });
      await gotoSeededDay(page);
      await selectPractitioner(page, SLOTS_DR);
      await syncSettled(page);
      type Stored = Record<string, unknown> & { id: string; visit_date: string; status: string };
      const doctor = (await readStore<Stored>(page, "practitioners")).find((row) => row.full_name === SLOTS_DR)!;
      const seeded = (await readStore<Stored>(page, "visits")).filter(
        (visit) => visit.practitioner_id === doctor.id && visit.status !== "cancelled",
      );
      const shift = (value: unknown) =>
        typeof value === "string" ? new Date(new Date(value).getTime() + 86_400_000).toISOString() : value;
      await putRows(
        page,
        seeded.map((visit, index) => ({
          store: "visits",
          value: {
            ...visit,
            id: `compare-tomorrow-${index + 1}`,
            visit_date: addDaysToClinicDay(visit.visit_date, 1),
            scheduled_at: shift(visit.scheduled_at),
            unique_scheduled_at: shift(visit.unique_scheduled_at),
            status: "booked",
            arrived_at: null,
            started_at: null,
            ended_at: null,
          },
        })),
      );
      await reloadAs(page, { name: ASSISTANT_NAME, pin: DEV_SEED_PINS.assistant });
      await page.getByRole("button", { name: S.daySheetButtonLabel, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText(S.daySheetTitle)).toBeVisible();
      await expect(sheet.getByRole("row")).toHaveCount(seeded.length + 1);
      return sheet;
    },
  },
  {
    n: 9,
    title: "Doctor's day",
    captured: "The whole page: the doctor's day mid-morning (the screenshot layer's doctor-day fixture).",
    drive: async (page) => {
      await doctorDayFixture(page);
      return "page";
    },
  },
  {
    n: 10,
    title: "Visit workspace",
    captured: "The visit sheet for كريم in the room: history, complaint, diagnosis and three drugs (no plan under way).",
    drive: async (page) => {
      await karimWorkspaceWithHistory(page);
      await rowFor(page, PATIENTS.karim).getByRole("button", { name: S.visitFormPillLabel, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await fillWorkspace(sheet);
      return sheet;
    },
  },
  {
    n: 11,
    title: "Audit log",
    captured: "The audit sheet on the real day: three bookings, an arrival, a cancellation and a no-show.",
    drive: async (page) => {
      await auditDayFixture(page);
      return page.getByRole("dialog");
    },
  },
  {
    n: 12,
    title: "Settings — working hours",
    captured: "The settings sheet, working-hours tab, as the owner.",
    drive: async (page) => {
      const dialog = await openSettings(page);
      await expect(dialog.getByRole("listitem")).toHaveCount(7);
      return dialog;
    },
  },
  {
    n: 13,
    title: "Settings — services",
    captured: "The settings sheet, services tab, as the owner, one service stopped (as the prototype).",
    drive: async (page) => {
      const dialog = await openSettings(page);
      await dialog.getByRole("button", { name: S.settingsServicesTab, exact: true }).click();
      const stopped = dialog.getByRole("listitem").filter({ hasText: "فحص شامل" }).getByRole("switch");
      await stopped.click();
      await expect(stopped).toHaveAttribute("aria-checked", "false");
      return dialog;
    },
  },
  {
    n: 14,
    title: "Settings — staff",
    captured: "The settings sheet, staff tab, as the owner.",
    drive: async (page) => {
      const dialog = await openSettings(page);
      await dialog.getByRole("button", { name: S.settingsStaffTab, exact: true }).click();
      await expect(dialog.getByRole("listitem").filter({ hasText: ASSISTANT_NAME })).toBeVisible();
      return dialog;
    },
  },
  {
    n: 15,
    title: "Device activation",
    captured: "The activation card before activating, both fields filled.",
    drive: async (page) => {
      await page.goto("/");
      const card = page.getByRole("dialog", { name: registrationStrings.formAria });
      await card.getByLabel(registrationStrings.codeLabel).fill("CLT-7F3K-9QRT-4XWM-2BCD");
      await card.getByLabel(registrationStrings.phoneLabel).fill("01001112233");
      return card;
    },
  },
  {
    n: 16,
    title: "Printed prescription",
    captured: "The print sheet's preview for كريم's three drugs, before the first print (the preview, not the paper).",
    drive: async (page) => {
      await page.addInitScript(() => {
        window.print = () => {};
      });
      return karimPrescriptionPreview(page);
    },
  },
  {
    n: 17,
    title: "Care plan",
    captured: "The care plan sheet: five sessions done, the sixth booked, four suggested.",
    drive: async (page) => carePlanSheetFixture(page),
  },
  {
    n: 18,
    title: "Patient profile",
    captured: "The whole page: كريم's profile from the patients page, on the الكل tab.",
    drive: async (page) => {
      await karimProfileFixture(page);
      await openProfileFromSearch(page, PATIENTS.karim, PATIENTS.karim);
      return "page";
    },
  },
  {
    n: 19,
    title: "Messages",
    captured: "The whole page: the messages page with three recent messages, the booking confirmation template selected.",
    drive: async (page) => {
      await messagesPageFixture(page);
      const templates = page.getByRole("navigation", { name: MSG.templatesHeading });
      await templates.getByRole("button", { name: /تأكيد الحجز/ }).click();
      await expect(page.getByRole("region", { name: `${MSG.previewPrefix} تأكيد الحجز` })).toBeVisible();
      return "page";
    },
  },
];

/** The settings sheet, opened by the owner from the seeded Monday's slots day. */
async function openSettings(page: Page): Promise<Locator> {
  await page.clock.install({ time: compareAt("10:00") });
  await page.goto("/?seedDay=1");
  await page.evaluate(() => localStorage.clear());
  await login(page, { name: OWNER_NAME, pin: OWNER_PIN });
  await selectPractitioner(page, SLOTS_DR);
  await page.getByRole("button", { name: S.settingsButtonLabel, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(S.settingsHoursTab, { exact: true })).toBeVisible();
  return dialog;
}

const fileName = (n: number) => `s${String(n).padStart(2, "0")}-${test.info().project.name}.png`;

// The prototype loads IBM Plex Sans Arabic from Google Fonts; the capture
// blocks every network request and gives it the app's own font files
// instead (web/src/index.css's @font-face rules, inlined), so both sides
// render the same font and the capture never depends on the network.
function inlinedFontFaces(): string {
  const css = readFileSync("src/index.css", "utf8");
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return faces
    .map((face) =>
      face.replace(/url\("\/fonts\/([^"]+)"\)/g, (_match, file: string) => {
        const data = readFileSync(path.join("public/fonts", file)).toString("base64");
        return `url("data:font/woff2;base64,${data}")`;
      }),
    )
    .join("\n");
}

// A sheet scrolls inside its own dialog element and is capped to the
// viewport's height; the window grows until the whole sheet fits, so the
// capture shows all of it.
async function fitSheet(page: Page, sheet: Locator): Promise<void> {
  const overflow = await sheet.evaluate((element) => element.scrollHeight - element.clientHeight);
  if (overflow > 0) {
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width, height: height + overflow + 8 });
  }
  await expect.poll(() => sheet.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await sheet.evaluate((element) => element.scrollTo(0, 0));
}

// A whole page is captured with the window grown to it, so the sticky app
// bar and the fixed mobile bottom bar sit where they belong, not mid-image.
async function fitPage(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

const errorsByPage = new WeakMap<Page, Error[]>();

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  errorsByPage.set(page, errors);
  page.on("pageerror", (err) => errors.push(err));
});

test.afterEach(async ({ page }) => {
  expect(errorsByPage.get(page) ?? []).toEqual([]);
});

for (const screen of SCREENS) {
  test(`@compare prototype s${screen.n}`, async ({ page }) => {
    // Only the file itself loads: the fonts come inlined below.
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(PROTOTYPE_URL);
    // The document's own sticky top bar would be painted over the section.
    await page.addStyleTag({ content: `${inlinedFontFaces()}\n.topbar{position:static}` });
    await page.evaluate(async () => {
      await Promise.all(
        [300, 400, 500, 600, 700].map((weight) => document.fonts.load(`${weight} 16px "IBM Plex Sans Arabic"`, "عA1")),
      );
      await document.fonts.ready;
    });
    const section = page.locator(`#s${screen.n}`);
    await expect(section).toBeVisible();
    await section.screenshot({ path: `${OUT_DIR}/proto/${fileName(screen.n)}`, animations: "disabled" });
  });

  test(`@compare app s${screen.n}`, async ({ page }) => {
    const target = await screen.drive(page);
    const out = `${OUT_DIR}/app/${fileName(screen.n)}`;
    if (target === "page") {
      await fitPage(page);
      await page.screenshot({ path: out, fullPage: true, animations: "disabled" });
    } else {
      if ((await target.getAttribute("role")) === "dialog" && (await target.evaluate((element) => element.scrollHeight > element.clientHeight))) {
        await fitSheet(page, target);
      }
      await target.screenshot({ path: out, animations: "disabled" });
    }
  });
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The index is the same for both viewports, so one project writes it.
test("@compare index", async () => {
  test.skip(test.info().project.name !== "desktop", "written once, by the desktop project");
  const id = (n: number) => `s${String(n).padStart(2, "0")}`;
  const pair = (n: number, viewport: string) => `
      <div class="viewport">
        <h3>${viewport}</h3>
        <div class="pair ${viewport}">
          <figure><figcaption>Prototype</figcaption><img loading="lazy" src="proto/${id(n)}-${viewport}.png" alt="Prototype ${id(n)} ${viewport}"></figure>
          <figure><figcaption>App</figcaption><img loading="lazy" src="app/${id(n)}-${viewport}.png" alt="App ${id(n)} ${viewport}"></figure>
        </div>
      </div>`;
  const rows = SCREENS.map(
    (screen) => `
    <section id="${id(screen.n)}">
      <h2><a href="#${id(screen.n)}">${screen.n}. ${escapeHtml(screen.title)}</a></h2>
      <p class="note">App capture: ${escapeHtml(screen.captured)}</p>${pair(screen.n, "desktop")}${pair(screen.n, "mobile")}
    </section>`,
  ).join("\n");
  const nav = SCREENS.map((screen) => `<a href="#${id(screen.n)}">${screen.n}. ${escapeHtml(screen.title)}</a>`).join("\n      ");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clintra — app vs prototype</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #eff3f1; color: #0b211d; }
  header { position: sticky; top: 0; background: #0b211d; color: #f2f7f5; padding: 10px 16px; z-index: 1; }
  header h1 { margin: 0 0 6px; font-size: 16px; }
  nav { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; }
  nav a { color: #c68a38; text-decoration: none; }
  main { padding: 16px; }
  section { background: #fff; border: 1px solid #d9e0dd; border-radius: 12px; padding: 12px 16px; margin-bottom: 24px; scroll-margin-top: 90px; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  h2 a { color: inherit; text-decoration: none; }
  h3 { margin: 12px 0 6px; font-size: 13px; color: #55665f; text-transform: uppercase; letter-spacing: .05em; }
  .note { margin: 0; font-size: 13px; color: #55665f; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
  .pair.mobile { grid-template-columns: repeat(2, minmax(0, 390px)); }
  figure { margin: 0; }
  figcaption { font-size: 12px; font-weight: 600; color: #a8742a; margin-bottom: 4px; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid #d9e0dd; }
</style>
</head>
<body>
<header>
  <h1>Clintra — the app against docs/reference/clintra-prototype.html, screen by screen</h1>
  <nav>
      ${nav}
  </nav>
</header>
<main>
${rows}
</main>
</body>
</html>
`;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/index.html`, html);
});
