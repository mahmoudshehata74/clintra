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
Web: `pnpm --dir web test` (vitest, 1188 passed) · `pnpm --dir web
exec tsc -b --noEmit` · `pnpm --dir web build` · `pnpm --dir web test:e2e`.
API: `cd api && php artisan test` (Pest, 325 passed).

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

`messages` + `message_templates` (step 6, data only): done — migration, RLS,
sync (push, pull, bootstrap), local store (database version 18), audited
writers in `web/src/db/messages.ts`, template definitions and
`renderTemplate` in `web/src/domain/messageTemplates.ts`, wa.me/sms links in
`web/src/domain/messageLink.ts`; no UI yet (`docs/schema.md`'s v19
additions; `api/docs/rls.md`'s "Messages and message templates"). Owner
decisions it implements:
1. Six fixed template keys whose names, descriptions, kinds and default bodies ship in web code; `message_templates` stores only an organization's edited body for one of the five editable keys, and "reset to default" deletes it.
2. A message row is written when the app opens WhatsApp or SMS for it (`attempted_at`); only `marked_sent_at` ("اتبعتت", by hand) ever changes, and messages are never deleted (`message_immutable`).
3. No provider and no delivery status: `https://wa.me/<digits>?text=` and `sms:<E.164>?body=`, built by the pure `buildMessageLink`.
4. Messages are scoped like invoices (org + locations), templates like practitioners (org); owner-only template editing is enforced on the device only — the same known server gap as other settings writes.

19 messages (step 6): done — `web/src/screens/messages/` (MessagesScreen,
SendMessageSheet, pure helpers in `messagesModel.ts`), the rail page
"الرسائل" (nav key `messages`) and the send sheet opened from the day
screen's VisitMenu and from a printed prescription; writes go through
`db/messages.ts`. The owner decisions it implements are listed under
"Screen 19 (messages)" below.

`care_plans` + `care_plan_items` (step 7, data only): done — migration
(policies narrowed to the visits scope on empty tables, `visit_id`
nullable, `rev`), sync (push rules, pull, bootstrap stages 8–9), local
store (database version 20), audited writers in `web/src/db/carePlans.ts`,
derivations in `web/src/domain/carePlan.ts`; no UI yet (`docs/schema.md`'s
v20 additions; `api/docs/rls.md`'s "Care plans"). Owner decisions it
implements:
1. Billed per session: a session's visit is billed on completion at the session's own price; a plan's paid is derived from its linked visits' payments, and `care_plans.paid` stays 0, unread.
2. A plan is created from a visit (its practitioner, patient, location; diagnosis from the visit form) with a goal and groups of sessions (service, count, gap), priced at the service's effective price at creation.
3. `care_plan_items.visit_id` is the only link: booking a session sets it, moving the visit carries it, cancelling or a no-show clears it, each in the visit's own transaction.
4. Stored statuses are only active/stopped and planned/skipped; done, booked, suggested, dates, completed and stalled are derived.
5. Edits (goal, diagnosis, added sessions, skip/unskip, stop/resume) are the plan practitioner's only, enforced on the device; nothing is deleted.

Before screen 17 (done): undoing a move, a cancel or a no-show (and a
session's booking) restores the session link with the visit, in the same
transaction (`db/visitUndo.ts`); a plan is completed only with at least one
done session; the audit sheet lists care plan rows under "الزيارات".

17 care plan (step 7): done — `web/src/screens/carePlan/` (CarePlanSheet
with its create and edit forms, CarePlanEntry in the visit workspace,
CarePlanBookingSheet, pure helpers in `carePlanModel.ts`); writes go
through `db/carePlans.ts`, bookings through the day screen's BookingSheet
with an optional prefill. The owner decisions it implements are listed
under "Screen 17 (care plan)" below.

This changes the earlier plan below ("templates seeded by migration"):
defaults now ship with the app and only overrides live in the database,
because a seed would only reach the organizations that exist when the
migration runs — every organization provisioned later would have none.

### Screen 19 (messages) — owner decisions over the prototype
- a. Rail item "الرسائل" (nav key `messages`) for every role, after "الزيارة الحالية" (after "اليوم" for roles without the doctor items). The page follows `.msg-layout`: `.msg-side` lists the six templates in their defined order with `.icn`, name, description and badge ("مقترح" `.badge.auto`, "اختياري" plain, "يدوي" `.badge.manual`); `.msg-main` shows the selected one.
- b. `.msg-preview` shows the effective body (override or default) with each known placeholder as a `.var` chip with its Arabic label (اسم المريض، اسم العيادة، هاتف العيادة، التاريخ، الوقت، اسم الطبيب، الجلسة، المبلغ المتبقي). `.ch` reads "قابل للتعديل" for the owner, "معدّل" when an override exists. Owner only: "تعديل" switches to the shared TextArea with the raw body and one insert chip per placeholder; "حفظ التعديلات" (`saveTemplateBody`), "إلغاء", and "رجّع النص الأصلي" when an override exists (`resetTemplate`). Others read it. Custom shows "الرسالة دي بتتكتب وقت الإرسال" and no editor.
- c. The prototype's channel toggle is not on this page (templates are channel-agnostic); it lives in the send sheet.
- d. SendMessageSheet, from VisitMenu's "ابعت رسالة" (any visit whose patient exists — an owner-approved addition) and from "واتساب" / "SMS" on a printed prescription (shown only once printed). Template picker (ToggleGroup; the prescription entry preselects custom with the prescription text: RX number, patient, one numbered line per drug "name — form: instructions · duration", note lines, "د. {name}"); the filled text in an editable TextArea (edits affect this message only); "فيه بيانات ناقصة: …" for unfilled placeholders, never blocking; the `.msg-ch-toggle` channel toggle, WhatsApp by default; "افتح واتساب" / "افتح SMS" call `recordMessageAttempt`, then open the link (`window.open` for wa.me, the location for sms:); refusals (no phone, empty text, device errors) show in the sheet and open nothing. Values: patient name; clinic name and phone from the printClinic sources (organization, the visit's location); the visit's date and booked time; the visit's practitioner's name; the balance (invoice total − paid, when above zero, as money); the session label stays missing until screen 17.
- e. `.msg-sent` "آخر الرسائل": the 20 most recent messages the membership can see (organization, and its locations unless it covers all), newest first: `.icn.wa` / `.icn.sms`, "name · phone" (local display, left to right), `.snip` = the body's first line cut to 60 characters with "…", and a status button: "اتفتحت" (`.st.pending`) marks it sent, "اتبعتت" unmarks it. Empty: "لسه مفيش رسائل".
- f. Below 768px `.msg-side` is a horizontal row of template chips above `.msg-main`.
- WhatsApp's green (`#25D366`, `.icn.wa` and the toggle's dot) is the `whatsapp` token (`docs/design-tokens.md`).

### Screen 17 (care plan) — owner decisions over the prototype
- a. Entry points, in the visit workspace (at the top of `.visit-main`): with a plan under way (active, not completed) between the patient and the visit's practitioner, s10's `.plan-badge` "خطة رعاية جارية: {goal}" with `.p` "جلسة {n} من {count}" (n = the session this visit books, else the done sessions + 1, over the sessions not skipped), opening the plan; without one, the visit's own practitioner gets "ابدأ خطة رعاية" on an in_room or completed visit, opening the create form in the same sheet. One plan under way per patient per practitioner: `createCarePlan` and `resumeCarePlan` refuse another with `plan_already_active` (a stopped or completed plan does not count).
- b. Create form (shared Field/TextInput/TextArea/ToggleGroup): "الهدف" (required), "التشخيص" (from the visit form, required), session groups — service (active services, with their effective price), "عدد الجلسات" (≥ 1), "كل كام يوم" (≥ 0), "＋ نوع جلسات تاني", "شيل" while more than one — and a live preview of the sessions (number, service, suggested "d / m": the first today, each later one its group's gap after the one before) with their total. Messages show after the first "ابدأ الخطة"; nothing is written until it succeeds; a refusal shows as one line.
- c. CarePlanSheet per s17: `.plan-hero` (avatar initial, name, "الهدف: …" · "التشخيص: …", `.kbd` "{count} جلسات" with arabicCount), `.plan-progress` ("التقدم", "{done} / {count} جلسة", bar = done/count), `.plan-legs` (بدأت, متوقع الانتهاء — "—" while no session has a date —, الإجمالي, المدفوع: "d / m / yyyy", money as "2,500 ج.م"); a status line: "الخطة اكتملت", else "الخطة متوقفة", else the stalled warning "المريض متوقف من N يوم". `.plan-sessions`: `.n` = sequence; name = service; `.meta` "d / m · د. {doctor} · {duration} دقيقة" for done and booked (booked adds "h:mm" after the day, the app's 24-hour clock without a leading zero), "d / m · مقترح" for a dated suggestion, nothing for an undated or skipped one; `.st` "تمّت" (`.done`), "التالية" (`.next`, the first booked session) or "محجوزة" (a later booked one), "مقترحة" (`.st.plan`), "مؤجلة" (muted). The plan's practitioner gets "أجّل" on a suggested row and "رجّع" on a skipped one.
- d. `.split`: "احجز الجلسة التالية" (anyone) opens the day screen's BookingSheet with an optional prefill — the plan's patient, the session's service (fixed), the session's suggested day (today when it has passed or there is none), a day at a time either way but never before today, and the session's id, linked by `bookExistingPatientVisit` or, in queue mode, `addToQueue` (which now takes `carePlanItemId` too); without a prefill the sheet is unchanged. Disabled with "الجلسة التالية محجوزة {d / m · h:mm}" while the first open session is booked; absent when the plan is stopped or completed, or has only skipped sessions left. A booking made here offers no undo toast. "عدّل الخطة" (plan's practitioner only): goal, diagnosis, "＋ ضيف جلسات" (one group), "وقّف الخطة" / "رجّع الخطة". "أرسل تذكير للمريض" opens SendMessageSheet for the first booked session's visit with `care_plan_session_reminder` preselected (its own filled text); disabled with "احجز الجلسة الأول" while nothing is booked.
- e. The doctor day's attention card gets no stalled-plan item; screen 18 will show it.
- A plan whose every session is skipped is not completed (it reads as active with nothing to book).
- e2e: a write made straight into IndexedDB (a past visit, another device's plan) needs `syncSettled` first — the demo server's pull puts back its own copy of every pushed row — and a reload after (`reloadAs`): Dexie answers live queries from its own cache.

## Backlog
- Messages: a "suggested today" list on the messages page (tomorrow's appointment reminders, follow-ups due, balances a week old), so the suggested templates are offered for the right patients instead of being opened one visit at a time.
- Sync: the first pull after a load waits for the 10-second timer, because the first cycle runs before the device is registered; start a cycle as soon as registration completes.

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
- `messages` + `message_templates`; template defaults ship with the app and
  `message_templates` holds only an organization's overrides (originally
  "seeded by migration" — changed, see above). A message row records
  `attempted_at`; "sent" is marked manually. WhatsApp opens `wa.me`, SMS
  opens `sms:`. No messaging provider in v1. Done (data only).
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
