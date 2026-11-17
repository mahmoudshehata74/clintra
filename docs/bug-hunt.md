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
| A-01 | Settings → staff | any | "＋ إضافة موظف" | A way back out of the form | No cancel: only saving, or closing the settings sheet (`StaffPanel.tsx` says the save is its one action) | minor | decided: the form gets "إلغاء" like every other settings form — fixed in f133688 |
| A-02 | Audit log | any | Open it right after an action | — | The newest rows read "من 0د" | minor | decided: under a minute reads "دلوقتي" wherever the "من Nد" pattern is used — the audit log was the one place left; fixed in 9d757b0 |
| A-03 | Settings → working hours | any | Hardening scenario 24: switch a doctor between slots and queue | A way to switch | No control switches a schedule's mode; the scenario cannot be run | major | decided: a slots/queue switch in the hours editor, taking effect from the next day (today and its visits keep today's mode, said under the switch) — done in `feat/schedule-mode-from-tomorrow`: the owner authorised `schedules.next_mode` and `next_mode_from` (`docs/schema.md`'s v23 additions) |
| A-04 | Invoice, audit log | two devices | Device A completes a visit; open its invoice and the audit log on device B | — | B's invoice reads "إنشاء 19:14" with no name, and B's audit log lists none of A's actions: `audit_log` is local to the device that wrote it | minor | decided: audit rows sync across devices, with a server table and RLS — done in `feat/audit-sync` (`docs/audit-sync.md`) |
| A-05 | Sync review, services, messages, visit workspace | any | A write fails (refused or a storage error) | An Arabic line saying it did not save | Silent: "خليها كده"/"شيلها"/"تمام", a price override's "حذف", a message's "اتفتحت"/"اتبعتت", and a visit field's save on blur leave an unhandled rejection and no message | minor | decided: one shared line, "ماتحفظش، جرّب تاني" (`saveFailedStrings` in `web/src/components/strings.ts`) — fixed in e4db891 |
| A-06 | Move and cancel sheets | any | Open either | — | No head and no close button, unlike every other sheet (backdrop, drag and Escape still close them); they predate the restyle and were left tokens-only | minor | decided: yes, through `SheetHeader` — fixed in 647cf2b |
| A-07 | Provisioning (CLI) | Windows console | `php artisan clintra:provision` with an Arabic clinic or doctor name | The name stored as typed | The console layer reads input in the OEM code page, which has no Arabic: the name is stored garbled (seen when answers are piped; a Windows console cannot type Arabic in that code page either) | major | decided: a documented rule, no code change — run `clintra:provision` on the Linux server (or WSL) in a UTF-8 shell (`api/README.md`, `docs/session-handoff.md`) |

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
  scenario 24 among them since A-03's switch was built
  (`web/e2e/schedule-mode-switch.spec.ts`, and the live run's scenario 11).
- An 8-hour offline window (hardening section 7).

## Progress

All six steps are done: the delay picker (B-01), the audit and the fixes
it forced (B-02), the exploratory pass (B-03, B-04, A-01–A-03, A-06), the
live run and the sync fixes it forced (B-05–B-11, A-04, A-07), the code
sweep (A-05) and this table. What is left is the gate and the pull
request.

## Decisions (fix/bug-hunt-asks)

The owner decided every [ask] row; the table's Status column records each
decision. A-01, A-02, A-05 and A-06 are fixed with their tests; A-07 is a
documented rule; A-04 is done (`feat/audit-sync`); A-03 is done
(`feat/schedule-mode-from-tomorrow`).

### Existing tests edited

- `web/e2e/hardening.spec.ts` ("moving an appointment to tomorrow takes 3
  taps or fewer"): found the move sheet's day groups by a CSS class the
  shared sheet body (A-06) no longer carries; it now takes the second day's
  slot list by role, the same target, the same three taps.
- Otherwise none: every decision added new tests (`web/e2e/settings.spec.ts`,
  `audit-elapsed.spec.ts`, `sync-review.spec.ts`, `messages.spec.ts`,
  `visit-workspace.spec.ts`, `sheet-padding.spec.ts`,
  `web/src/components/ui/attemptSave.test.ts`); `web/e2e/support.ts` gained
  `setStorageWritesFailing` and `SAVE_FAILED`.
