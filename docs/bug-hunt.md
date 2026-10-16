# Bug hunt

A full pass over the app on `fix/bug-hunt`, from `main` at 5fa067d:

1. The known doctor-delay picker bug.
2. An automated interaction audit of every screen and overlay
   (`web/e2e/audit.spec.ts`, run by the normal e2e on both projects).
3. An exploratory pass by eye: hardening section 9's scenarios and the
   day-to-day flows at 1280×800 and 390×844, light and dark, captured into
   `web/e2e/bug-hunt/` (gitignored) and viewed one by one, together with
   `pnpm --dir web test:compare`'s captures.
4. Two devices syncing live against the real API on `clintra_test`
   (`web/e2e-live/`, `pnpm --dir web test:live`).
5. A code-level sweep for the same bug shapes elsewhere.

Every fix has a regression test in the normal suites (vitest, e2e or Pest),
checked to fail without the fix.

## Findings

Severity: **blocker** (data never syncs, or syncs wrong), **major** (a
screen or flow is wrong or unusable as it stands), **minor** (cosmetic or
an edge).

| Id | Screen | Viewport / theme | Steps | Expected | Actual | Severity | Status |
|---|---|---|---|---|---|---|---|
| B-01 | Day (slab) | both / both | Tap "تسجيل تأخير الطبيب" | The picker opens whole, on screen | Clipped by the slab's overflow-hidden frame to a white sliver under the buttons; presets only | major | fixed in ce85052 (Popover portal, minutes field 1–240) |
| B-02 | Day (row ⋯ menu) | 1280×800 / both | Open the ⋯ menu of the first slot's row | The menu opens inside the window | It ran past the window's bottom edge | major | fixed in 75093c3 |
| B-03 | Move and cancel sheets | 390 / both | ⋯ → "نقل لميعاد تاني" or "إلغاء" | Text inside the sheet's padding | Heading and patient set flush against the card's edge, the first letter cut by its rounded corner | minor | fixed in 76316c7 |
| B-04 | Printed prescription preview | 390 / both | Open "اطبع الوصفة" | The clinic phone on one line | It wrapped inside the number: "02 2123" / "4567" | minor | fixed in 7f7f8af |
| B-05 | Every synced screen | any | Register a real device, write anything | The write reaches the server | `HttpTransport` and `HttpStaffServer` called the stored global `fetch` as a method: "Illegal invocation" before any request; the chip went to "السيرفر مش راد"; adding staff always failed | blocker | fixed in 6d951df |
| B-06 | Day | any | Settings → make today a working day (or rename a doctor, or receive another device's schedule) | The day screen shows it | Only after a reload: a newly registered clinic stayed on "مواعيد العمل لسه مش متسجلة" after its owner set the hours | major | fixed in ee85399 |
| B-07 | Sync push | any | Create anything on a registered device | The create is accepted | Every create carried `base_rev: null`; the server's validation (`integer`, prohibited on a create) failed the whole batch with 422, so nothing created ever left the device | blocker | fixed in de2d63f |
| B-08 | Sync pull (settings, slab, visit form) | any | Pull a schedule, a visit, a visit form from the server | Rows in the devices' shapes (docs/schema.md: instants ISO 8601 UTC, times HH:MM) | Postgres text: "17:00:00 — 09:00:00" in the hours tab, "إقفال 17:00:00" on the slab, instants as "2026-10-16 09:00:00+03" (no longer sorting against the device's own), a visit form's jsonb as a string | major | fixed in c3a0a40 (api, Pest) |
| B-09 | Day | any | Mark a patient arrived, then call them in, before the first push is acknowledged | Both changes sync | Both carried the same base_rev; the server refused the second as stale: a review against itself, and the pull put the visit back to "وصل" | blocker | fixed in b36cb54 |
| B-10 | Sync review list | any | Two devices book one slot offline; the loser opens "فيه حاجة محتاجة مراجعة" | The row names the booking | "زيارة — الميعاد ده اتحجز من جهاز تاني" with keep/remove and no patient or time, until a later pull displaced it | minor | fixed in 7bc7f7e |
| B-11 | Sync review list | both / light | Open "فيه حاجة محتاجة مراجعة" | Readable text | The sheet sits inside the app bar and inherited its on-dark text: near white on the white card | major | fixed in 0dbaa69 |
| A-01 | Settings → staff | any | "＋ إضافة موظف" | A way back out of the form | No cancel: only saving, or closing the settings sheet (`StaffPanel.tsx` says the save is its one action) | minor | [ask] Add "إلغاء" to the add-staff form like every other settings form? |
| A-02 | Audit log | any | Open it right after an action | — | The newest rows read "من 0د" | minor | [ask] Keep "من 0د" in the first minute, or show something like "دلوقتي"? |
| A-03 | Settings → working hours | any | Hardening scenario 24: switch a doctor between slots and queue | A way to switch | No control switches a schedule's mode; the scenario cannot be run | major | [ask] Add a slots/queue switch to the hours editor (and what happens to the day's visits), or drop scenario 24? |
| A-04 | Invoice, audit log | two devices | Device A completes a visit; open its invoice and the audit log on device B | — | B's invoice reads "إنشاء 19:14" with no name, and B's audit log lists none of A's actions: `audit_log` is local to the device that wrote it | minor | [ask] Is per-device attribution the intended v1 behaviour, or should audit rows sync? |
| A-05 | Sync review, services, messages, visit workspace | any | A write fails (refused or a storage error) | An Arabic line saying it did not save | Silent: "خليها كده"/"شيلها"/"تمام", a price override's "حذف", a message's "اتفتحت"/"اتبعتت", and a visit field's save on blur leave an unhandled rejection and no message | minor | [ask] The wording for a failed save on these controls (one shared line?) |
| A-06 | Move and cancel sheets | any | Open either | — | No head and no close button, unlike every other sheet (backdrop, drag and Escape still close them); they predate the restyle and were left tokens-only | minor | [ask] Give them `SheetPanelHead` (title + ×) like the others? |
| A-07 | Provisioning (CLI) | Windows console | `php artisan clintra:provision` with an Arabic clinic or doctor name | The name stored as typed | The console layer reads input in the OEM code page, which has no Arabic: the name is stored garbled (seen when answers are piped; a Windows console cannot type Arabic in that code page either) | major | [ask] Provision from a UTF-8 shell (Linux/WSL) as a documented rule, or have the command take the names as options? (no provisioning code changed here) |

The live run's scenarios that passed once the blockers above were fixed:
two-device booking and status, payment round trip, series letter, offline
work coming back once, server stop/restart, the same slot booked offline on
both, the same visit changed offline on both, adding staff offline (refused)
and online (`web/e2e-live/README.md`).

### Checked and not a bug

- The cash close's difference ("-140" read as "140-" in a screenshot):
  the glyph positions measured in the page put the minus on the left; it is
  in its own left-to-right run.
- The slab's "اكتمل N" counting no-shows and cancellations while
  "خلصوا" counts only completed visits: the prototype's `.split-leg` does
  the same ("اكتمل 4 من 5" beside "خلصوا 1").
- The queue's expected call times on the seeded day reading the real clock:
  `?seedDay=1` is the dev pin's known caveat.
- Focus moving from a sheet to the rail on Tab: the rail stays interactive
  over sheets by design (`Sheet.tsx`).
- Pulled instants lose their milliseconds: the timestamptz columns store
  whole seconds; nothing on the device depends on them.

## Code sweep

- Absolutely positioned popovers and menus: the delay picker and the row
  menu were the only two; both now use the shared `Popover`
  (`web/src/components/ui/Popover.tsx`). No other `absolute` overlay.
- Inputs whose value never updates state: none (every controlled input
  has an `onChange`).
- Unhandled promise rejections: the click handlers listed under A-05.
- Missing await on writes: none; every writer call is awaited, returned or
  inside a `Promise.all`.
- setState after unmount: the async effects all carry a `cancelled` flag.
- Date parsing without a timezone: none in web (every parse is an ISO
  instant or built with `Date.UTC`); the server's text-form instants were
  B-08.
- `toFixed` on money: one display use, `(price / 100).toFixed(2)` on
  integer piastres, which cannot round wrong at two decimals.
- Stored `fetch` called as a method: the two in B-05; `registration.ts`
  calls its `fetchImpl` as a plain function.

## Existing tests edited

- `web/e2e/support.ts` (`openSendSheetFromRow`) and
  `web/e2e/patient-profile.spec.ts`: looked the row menu's items up inside
  the row; the menu now renders in a body-level portal (B-02), so they look
  them up on the page.

## Not tested

- Real printing to paper and the browser's print dialog (the print target
  and `@page` rules are covered by the existing PDF assertions only).
- The clinic tablet hardware, the installed PWA, and WhatsApp/SMS actually
  opening (window.open is recorded, never followed).
- Hardening section 9 as the human drill it specifies (two people, an
  unannounced network cut); its scenarios were driven by script instead,
  and scenario 24 cannot be run (A-03).
- An 8-hour offline window (hardening section 7).

## Progress

All six steps are done: the delay picker (B-01), the audit and the fixes
it forced (B-02), the exploratory pass (B-03, B-04, A-01–A-03, A-06), the
live run and the sync fixes it forced (B-05–B-11, A-04, A-07), the code
sweep (A-05) and this table. What is left is the gate and the pull
request.
