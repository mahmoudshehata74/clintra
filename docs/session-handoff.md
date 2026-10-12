# Session handoff

## Phase
Design system rebuild. The visual reference for v1 is
`docs/reference/clintra-prototype.html` (19 screens); `docs/design-rule.md`
defines how to use it and lists the settled deviations from it. Logic and
data are not being rewritten: existing screens are restyled, and the new
screens are built on top of the existing data layer.

## Actual state (as of 8d993d7)
- **Web** (React + Vite PWA, offline-first, IndexedDB via Dexie): assistant
  day screen (slots and queue), booking and walk-in, visit actions, doctor
  delay, visit form (complaint + diagnosis), invoice, payments, cash close,
  tomorrow's day sheet, audit log, settings (working hours, services,
  staff), PIN lock (Argon2id, 5 attempts then a delay, 10-minute idle lock)
  and device registration.
- **Sync transport**: `HttpTransport` exists and is selected whenever the
  device row holds a real token (`selectSyncTransport` in
  `web/src/sync/httpTransport.ts`); `FakeTransport` remains for demo mode.
- **Fonts**: already bundled locally through `@fontsource` packages (IBM
  Plex Sans Arabic 400/500/600, Readex Pro variable) — nothing is fetched at
  runtime.
- **API**: device registration (`POST /api/devices/register`), sync push,
  pull and bootstrap endpoints, provisioning and activation-code CLI
  commands, full RLS on every tenant table (see `api/docs/rls.md`).

## Verify
Web: `pnpm --dir web test` (vitest, 959 passed) · `pnpm --dir web
exec tsc -b --noEmit` · `pnpm --dir web build` · `pnpm --dir web test:e2e`.
API: `cd api && php artisan test` (Pest, 260 passed).

## Rebuild order (approved)
1. `docs/design-rule.md` points at the prototype — done (PR #1).
2. This handoff.
3. Design tokens in `web/src/index.css` from the prototype's `:root`; move
   fonts to `web/public/fonts/` with local `@font-face`; remove Readex Pro.
4. Shared components, one per commit, each with a demo page: button,
   field, card, sheet, badge.
5. Existing assistant screens, restyled: 1 lock, 2 day slots, 3 queue,
   4 booking, 5 invoice, 6 payment, 7 cash close (with the past-due list),
   8 tomorrow's sheet.
6. New data + doctor screens: `visits.note` then 9 doctor day;
   `prescriptions` + `prescription_items` then 10 visit form, 16 prescription
   print; `messages` + `message_templates` then 19 messages.
7. 17 care plan.
8. 18 patient profile — last, because it aggregates everything else.
9. 15 device activation (restyle + post-activation confirmation).
10. Re-capture the Playwright screenshot layer for all 19 screens.

`visits.note` (step 6, data only): done — migration, sync, local store, audited setter.

9 doctor day (step 6): done — `web/src/screens/doctor/`, rail item "شاشة الطبيب"
for any membership with a `practitioner_id`; the quick note writes
`visits.note` through `setVisitNote`. The owner decisions it implements are
listed under "Screen 9 (doctor day)" below.

`prescriptions` + `prescription_items` (step 6, data only): done — migration,
RLS, sync (push, pull, bootstrap), per-device RX numbering, printed lock,
local store (database version 16) and audited writers in
`web/src/db/prescriptions.ts`; no UI yet (`docs/schema.md`'s v17 additions).
Owner decisions it implements:
1. At most one prescription per visit, created with its first item and
   numbered then in this device's series ("RX-{year}-{0000}", "RX-{year}-{L}-{0000}").
2. Items are editable only until the first print, which sets `printed_at` and
   snapshots the visit's diagnosis; after that every write is refused, on the
   device and by the server.
3. Item fields: name and instructions required, form, duration and note
   optional, position 1-based in append order and never renumbered.
4. Only the visit's own practitioner writes (`not_prescriber`); the server
   does not enforce who writes in v1 — a known gap (`api/docs/rls.md`).
5. Removing every item keeps the numbered prescription; an empty one cannot be
   printed (`prescription_empty`), and the skipped number is acceptable.

10 visit form (step 6): done — `web/src/screens/visit/` (VisitWorkspace,
pure helpers in `workspace.ts`), hosted by VisitFormSheet (same entry points)
and by the rail page "الزيارة الحالية"; prescription editing goes through
`db/prescriptions.ts`. The legacy tokens (`green-soft`, `line`,
`--radius-el`) had no use left and are retired. The owner decisions it
implements are listed under "Screen 10 (visit workspace)" below.

16 prescription print (step 6): done — `web/src/screens/prescription/`
(PrescriptionPrintSheet, RxPrintPage, pure helpers in `printModel.ts`), opened
from the visit workspace's `.rx-section` and reusable by screen 18; the first
print goes through `markPrescriptionPrinted`. The owner decisions it
implements are listed under "Screen 16 (printed prescription)" below. On
paper it is plain paper (the 12mm margin is `@page prescription`'s), a drug
never splits across pages and the signature stays with the last drug; the
audit log lists prescription events under "الزيارات", naming the patient.

Practitioner profile (decision A): done — practitioners sync, and the owner
edits each practitioner's name, title and syndicate number from the settings
tab "الأطباء" (`web/src/screens/day/PractitionersPanel.tsx`,
`web/src/db/practitioners.ts`); the printed prescription shows "رقم النقابة
{n}" (`docs/schema.md`'s v18 additions; `api/docs/rls.md`'s
"Practitioners"). Owner decisions it implements:
1. Name, title and syndicate number are the only editable fields;
   practitioners are still created only by provisioning, and the server
   refuses anything else (`practitioner_not_editable`).
2. The title is stored trimmed with `""` for none (the column stays NOT
   NULL); the syndicate number is stored trimmed with null for none, at most
   50 characters. One shared helper decides "empty" for every screen.
3. Owner only, enforced on the device like every other settings write — the
   server does not check who edits (a known gap, `api/docs/rls.md`).
4. Renaming an assistant or other staff member stays in the backlog: a staff
   name lives on `users`, which is not syncable (no single owning org —
   `docs/schema.md`'s v12 additions), so it needs its own decision.

## Data decisions for the rebuild
- `visits.note text NULL` — the doctor's quick note.
- `practitioners.syndicate_number varchar(50) NULL` — hidden when empty;
  done (decision A, above).
- `prescriptions` numbered `RX-{issued_year}-{sequence}`, sequential per
  location per calendar year, reserved with the same mechanism as invoice
  numbers (`prescriptions.issued_year` is a stored field).
- Per-device number series (owner decision): every device at a location
  gets its own series at registration and mints invoice and receipt numbers
  only inside it, so two devices never collide (`docs/schema.md`'s v16
  additions); prescriptions (RX) will reuse the same series rule.
- `messages` + `message_templates`; templates seeded by migration. A message
  row records `attempted_at`; "sent" is marked manually. WhatsApp opens
  `wa.me`, SMS opens `sms:`. No messaging provider in v1.
- Care plans use the existing `care_plans` and `care_plan_items`; there is
  no `care_plan_sessions` table. A session's label comes from its service
  name, its date from its linked visit or from the previous session plus
  `min_gap_days`; with neither, it shows as "session {n}".
- Cash close cannot complete while a `booked` visit whose time has passed
  is still unmarked, unless the assistant explicitly confirms. CSV export:
  date, patient, service, amount, payment status.
- Every new table goes through all of: `docs/schema.md`, a new Dexie
  version, an API migration, RLS policies, and the syncable-table list with
  `rev`.

### Screen 9 (doctor day) — owner decisions over the prototype
- a. Momentum: "متوسط الكشف" is the median of today's recorded consultations; "المخطط" the median service duration of today's occupying visits; lateness (slots only) is now minus the earliest overdue unstarted visit's time, "ماشي في الميعاد" at 5 minutes or less; queue mode shows the median and expected finish only; the bar is hidden until a consultation has a recorded length.
- b. Last visit: the patient's most recent completed visit before the current one, with any practitioner, showing complaint and diagnosis from the visit form; no "موصوف"; empty parts, and the whole block without a prior visit, are omitted.
- c. "افتح الملف" (patient profile) is not rendered until screen 18 exists.
- d. Attention card: only empty diagnoses ("أكمل الآن" opens the visit form) and unpaid or partially paid invoices (no button); no lab referral; not rendered when empty.
- e. Waiting room: arrived visits, waiting from `arrived_at` (fallback `created_at`); above 30 minutes a row is `.wait-item.long`, the header tag turns warning and the footer counts it; empty state "مفيش حد مستني".
- f. Quick note: placeholder "ملاحظة على الزيارة دي…" (the note is visible to anyone who sees the visit), saved through `setVisitNote`, "اتحفظ" after saving; unsaved text survives the idle lock because the screen stays mounted under the lock overlay.
- g. Calling in and closing the visit use the day screen's write paths and advance cooldown; the call button appears only where in_room is an allowed transition, disabled with "فيه مريض في الكشف" while someone is in the room.
- h. "مستني"/"مستنية" from `patients.gender` (`female`), neutral "مستني" otherwise.
- i. Age is the current Cairo year minus `birth_year`, omitted when unknown.
- j. Relative time: days under 14, weeks under 60 days, months after that, with Arabic singular/dual/plural forms.

### Screen 10 (visit workspace) — owner decisions over the prototype
- a. No `.visit-aside`: one `.visit-main` column; the field hint is only the autosave "اتحفظ"; autosave stays per field, on blur, focus-preserving.
- b. `.pt-summary`: avatar initial, name · age (omitted without birth_year), local mono LTR phone when present, "N زيارات · آخر زيارة قبل …" omitting empty parts; no `.quick` buttons until screen 18, no `.plan-badge` until screen 17.
- c. `.visit-history`: the last three completed visits before this one, any practitioner on the device, newest first — d/m, diagnosis (else complaint, else "من غير تشخيص"), " — " first two drug names then "+N"; heading by real count; hidden without a prior visit.
- d. Complaint and diagnosis are the shared Field + TextArea, saved as before.
- e. `.rx-section` with arabicCount ("دواء واحد"/"دوائين"/"3 أدوية"/"11 دواء"); item = LTR name + "instructions · duration" (note muted), tap to edit in place, "حذف", "＋ أضف دواء" inline form; writer errors mapped to Arabic; read-only when not the visit's practitioner, not prescribable, or printed ("الوصفة اتطبعت ومش ممكن تتعدّل"); hidden for a non-prescriber with no drug; the print button arrived with screen 16.
- f. `.runrow`: "قفل الزيارة" only while in_room through the caller's own completion path and cooldown; "حفظ ومتابعة لاحقًا" waits for the field save and closes; `.count` live while in_room, final once completed, "أقل من دقيقة" under one minute.
- g. One VisitWorkspace for VisitFormSheet and the "الزيارة الحالية" rail page (nav key `visit`, practitioner memberships only, after "شاشة الطبيب"): the practitioner's in_room visit today or "مفيش زيارة مفتوحة دلوقتي" with "افتح شاشة الطبيب"; stays mounted under the idle lock on the guarded acting membership.
- h. The legacy tokens are retired from `@theme` and `docs/design-tokens.md` (zero uses in web/src); dark mode stays off.

### Screen 16 (printed prescription) — owner decisions over the prototype
- a. Entry: "اطبع الوصفة" (printed: "اطبع تاني") in `.rx-section` whenever the prescription has a drug, for anyone who sees the section; it opens PrescriptionPrintSheet (Sheet, size lg) with the `.rx-print-page` preview.
- b. One action, "طباعة / حفظ PDF" (the browser's print dialog does both); no PDF button; WhatsApp and SMS wait for screen 19.
- c. The first print asks "بعد الطباعة الوصفة مش هتتعدّل. نطبع؟" ("اطبع" / "رجوع"), then `markPrescriptionPrinted`, then the dialog; reprints open the dialog with no write; refusals (not the visit's practitioner on a first print, empty, write failure) show an Arabic line and never open the dialog.
- d. A5 portrait through a named `@page prescription`, applied only to the print target (`.rx-print-target`, rendered in a body-level portal that leaves `#root` off paper); the day sheet, invoice and receipt keep the default page.
- e. `.rx-doc`: "د. {name}", "{title} · رقم النقابة {n}" (either part omitted when empty, the line when both are — decision A), the printClinic lines; `.rx-num` number and "d / m / yyyy" (print date once printed, today in the preview); `.rx-pt` name, age, diagnosis (snapshot once printed); one `.rx-drug` per item numbered 1..n by position; `.rx-sig`; no legal disclaimer (open owner decision); the screen-only `.rx-print-header`.
- f. After the first print the workspace shows the printed line and read-only list, and the button reads "اطبع تاني".

## Standing rules for the rebuild
- Existing logic and behaviour do not change; vitest and e2e stay green at
  every step, not just at the end.
- Screens without a prototype counterpart (visit menu, move, cancel, sync
  review) get the new tokens and fonts only. A design question that would
  change their behaviour is raised before it is answered.
- Navigation is a role-dependent sidebar: every role sees day, queue,
  messages, audit log, settings and patient search; the doctor also sees
  the doctor day and the current visit. Prescription and care plan open from
  the visit or the patient profile.
